import { authenticateByKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { db } from "@/lib/server/in-memory-db";
import { markReady } from "@/lib/services/match-scheduler";
import { NextResponse } from "next/server";

export const POST = handleApiError(async (req: Request): Promise<NextResponse> => {
  // Auth
  const auth = authenticateByKey(req);
  if (!auth.valid) {
    const apiKey = req.headers.get("x-agent-key");
    throw new ApiError(401, apiKey ? "INVALID_KEY" : "MISSING_KEY", auth.error);
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(auth.agentId, ip);
  if (!rl.allowed) return rl.response!;

  // Get matchId from URL
  const url = new URL(req.url);
  const segments = url.pathname.split("/");
  const matchesIdx = segments.indexOf("matches");
  const matchId = segments[matchesIdx + 1];

  const match = db.getMatch(matchId);
  if (!match) throw new ApiError(404, "NOT_FOUND", "Match not found");

  // Must be participant
  if (auth.agentId !== match.agentA && auth.agentId !== match.agentB) {
    throw new ApiError(403, "NOT_YOUR_MATCH", "You are not a participant in this match");
  }

  // PRD F04: Must be in READY_CHECK phase → 409 MATCH_NOT_IN_READY_CHECK
  if (match.currentPhase !== "READY_CHECK") {
    throw new ApiError(409, "MATCH_NOT_IN_READY_CHECK", "Match is not in READY_CHECK phase");
  }

  // Check deadline (PRD §4.10: t >= deadline → timeout handler wins)
  if (match.phaseDeadline && Date.now() >= match.phaseDeadline.getTime()) {
    throw new ApiError(409, "MATCH_NOT_IN_READY_CHECK", "Ready check deadline has passed");
  }

  const updated = markReady(matchId, auth.agentId);
  if (!updated) {
    throw new ApiError(409, "MATCH_NOT_IN_READY_CHECK", "Match is not in READY_CHECK phase");
  }

  // Check if both ready now
  if (updated.readyA && updated.readyB) {
    return NextResponse.json({
      status: "STARTING",
      firstRound: 1,
      commitDeadline: updated.phaseDeadline?.toISOString(),
    });
  }

  return NextResponse.json({
    status: "READY",
    waitingFor: "opponent",
  });
});
