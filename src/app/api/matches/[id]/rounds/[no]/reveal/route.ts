import { authenticateByKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { db } from "@/lib/server/in-memory-db";
import { handleBothRevealed, handleHashMismatch } from "@/lib/services/match-scheduler";
import { Move } from "@/types";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

const VALID_MOVES = new Set(["ROCK", "PAPER", "SCISSORS"]);
const SALT_REGEX = /^[\x21-\x7e]{16,64}$/;

function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

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

  const move = body.move as string | undefined;
  const salt = body.salt as string | undefined;
  const bodyAgentId = body.agentId as string | undefined;

  if (!move || !salt) throw new ApiError(400, "BAD_REQUEST", "move and salt are required");

  // agentId validation
  if (bodyAgentId && bodyAgentId !== auth.agentId) {
    throw new ApiError(403, "NOT_YOUR_MATCH", "agentId does not match authenticated agent");
  }

  // Canonicalization validation (PRD §F05b — at reveal, not commit)
  // No auto-trim: whitespace in move/salt → 400
  if (!VALID_MOVES.has(move)) {
    throw new ApiError(400, "INVALID_MOVE", "move must be exactly ROCK, PAPER, or SCISSORS");
  }

  if (!SALT_REGEX.test(salt)) {
    throw new ApiError(400, "INVALID_SALT", "salt must be 16-64 printable ASCII characters (0x21-0x7E), no whitespace");
  }

  const match = db.getMatch(matchId);
  if (!match) throw new ApiError(404, "NOT_FOUND", "Match not found");

  // Must be participant
  if (auth.agentId !== match.agentA && auth.agentId !== match.agentB) {
    throw new ApiError(403, "NOT_YOUR_MATCH", "You are not a participant in this match");
  }

  // Phase check
  if (match.currentPhase !== "REVEAL") {
    throw new ApiError(400, "ROUND_NOT_ACTIVE", "Match is not in REVEAL phase");
  }

  if (match.currentRound !== roundNo) {
    throw new ApiError(400, "ROUND_NOT_ACTIVE", `Expected round ${match.currentRound}, got ${roundNo}`);
  }

  // Check deadline
  if (match.phaseDeadline && Date.now() >= match.phaseDeadline.getTime()) {
    throw new ApiError(400, "ROUND_NOT_ACTIVE", "Reveal deadline has passed");
  }

  // Idempotent check
  const existingReveal = db.getReveal(matchId, roundNo, auth.agentId);
  if (existingReveal) {
    const otherAgentId = auth.agentId === match.agentA ? match.agentB : match.agentA;
    const otherReveal = db.getReveal(matchId, roundNo, otherAgentId);
    return NextResponse.json({
      status: "REVEALED",
      waitingFor: otherReveal ? "none" : "opponent",
    });
  }

  // Hash verification: sha256("{MOVE}:{SALT}") === commitHash
  const commit = db.getCommit(matchId, roundNo, auth.agentId);
  if (!commit) throw new ApiError(400, "BAD_REQUEST", "No commit found for this round");

  const expectedHash = sha256hex(`${move}:${salt}`);
  if (expectedHash !== commit.commitHash) {
    // Hash mismatch → round loss for this agent
    handleHashMismatch(matchId, roundNo, auth.agentId);
    throw new ApiError(422, "HASH_MISMATCH", "sha256(move:salt) does not match commit hash");
  }

  // Store reveal
  db.upsertReveal(matchId, roundNo, auth.agentId, move as Move, salt);

  // Check if both revealed
  const otherAgentId = auth.agentId === match.agentA ? match.agentB : match.agentA;
  const otherReveal = db.getReveal(matchId, roundNo, otherAgentId);

  if (otherReveal) {
    handleBothRevealed(matchId, roundNo);
    return NextResponse.json({ status: "REVEALED", waitingFor: "none" });
  }

  return NextResponse.json({ status: "REVEALED", waitingFor: "opponent" });
});
