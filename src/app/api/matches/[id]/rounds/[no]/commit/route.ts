import { authenticateByKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { db } from "@/lib/server/in-memory-db";
import { transitionToReveal } from "@/lib/services/match-scheduler";
import { Move } from "@/types";
import { NextResponse } from "next/server";

const HASH_REGEX = /^[0-9a-f]{64}$/;

export const POST = handleApiError(async (req: Request): Promise<NextResponse> => {
  // Auth
  const auth = authenticateByKey(req);
  if (!auth.valid) throw new ApiError(401, "INVALID_KEY", auth.error);

  // Parse URL params
  const url = new URL(req.url);
  const segments = url.pathname.split("/");
  const matchesIdx = segments.indexOf("matches");
  const matchId = segments[matchesIdx + 1];
  const roundNo = Number.parseInt(segments[segments.indexOf("rounds") + 1], 10);

  if (!Number.isInteger(roundNo) || roundNo <= 0) {
    throw new ApiError(400, "BAD_REQUEST", "Invalid round number");
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const hash = body.hash as string | undefined;
  const prediction = body.prediction as string | undefined;
  const bodyAgentId = body.agentId as string | undefined;

  if (!hash) throw new ApiError(400, "BAD_REQUEST", "hash is required");

  // Hash format validation
  if (!HASH_REGEX.test(hash)) {
    throw new ApiError(400, "INVALID_HASH_FORMAT", "hash must be a 64-character lowercase hex string");
  }

  // agentId validation
  if (bodyAgentId && bodyAgentId !== auth.agentId) {
    throw new ApiError(403, "NOT_YOUR_MATCH", "agentId does not match authenticated agent");
  }

  // Prediction validation
  if (prediction !== undefined && !Object.values(Move).includes(prediction as Move)) {
    throw new ApiError(400, "INVALID_PREDICTION", "prediction must be ROCK, PAPER, or SCISSORS");
  }

  const match = db.getMatch(matchId);
  if (!match) throw new ApiError(404, "NOT_FOUND", "Match not found");

  // Must be participant
  if (auth.agentId !== match.agentA && auth.agentId !== match.agentB) {
    throw new ApiError(403, "NOT_YOUR_MATCH", "You are not a participant in this match");
  }

  // Phase check
  if (match.currentPhase !== "COMMIT") {
    throw new ApiError(400, "ROUND_NOT_ACTIVE", "Match is not in COMMIT phase");
  }

  if (match.currentRound !== roundNo) {
    throw new ApiError(400, "ROUND_NOT_ACTIVE", `Expected round ${match.currentRound}, got ${roundNo}`);
  }

  // Check deadline
  if (match.phaseDeadline && Date.now() >= match.phaseDeadline.getTime()) {
    throw new ApiError(400, "ROUND_NOT_ACTIVE", "Commit deadline has passed");
  }

  // Idempotent check
  const existing = db.getCommit(matchId, roundNo, auth.agentId);
  if (existing) {
    const otherAgentId = auth.agentId === match.agentA ? match.agentB : match.agentA;
    const otherCommit = db.getCommit(matchId, roundNo, otherAgentId);
    return NextResponse.json({
      status: "COMMITTED",
      waitingFor: otherCommit ? "none" : "opponent",
    });
  }

  // Store commit (using existing db method, and store prediction separately)
  const commit = db.upsertCommit(matchId, roundNo, auth.agentId, hash);
  // Store prediction on commit record (hacky but works for in-memory)
  (commit as any).prediction = prediction ? prediction as Move : null;

  // Check if both committed
  const otherAgentId = auth.agentId === match.agentA ? match.agentB : match.agentA;
  const otherCommit = db.getCommit(matchId, roundNo, otherAgentId);

  if (otherCommit) {
    transitionToReveal(matchId, roundNo);
    return NextResponse.json({ status: "COMMITTED", waitingFor: "none" });
  }

  return NextResponse.json({ status: "COMMITTED", waitingFor: "opponent" });
});
