/**
 * POST /api/agents/me/qualify/{qualMatchId}/rounds/{roundNo} — Submit round move
 */

import { NextResponse } from "next/server";
import { authenticateByKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { submitQualRound } from "@/lib/services/qual-service";
import { Move } from "@/types";

const VALID_MOVES = new Set(["ROCK", "PAPER", "SCISSORS"]);

export const POST = handleApiError(async (
  req: Request,
  { params }: { params: Promise<{ qualMatchId: string; roundNo: string }> },
) => {
  const auth = authenticateByKey(req);
  if (!auth.valid) {
    const apiKey = req.headers.get("x-agent-key");
    throw new ApiError(401, apiKey ? "INVALID_KEY" : "MISSING_KEY", auth.error);
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(auth.agentId, ip);
  if (!rl.allowed) return rl.response!;

  const { qualMatchId, roundNo: roundNoStr } = await params;
  const roundNo = parseInt(roundNoStr, 10);
  if (isNaN(roundNo) || roundNo < 1) {
    throw new ApiError(400, "INVALID_ROUND", "roundNo must be a positive integer");
  }

  const body = await req.json().catch(() => null);
  if (!body || !VALID_MOVES.has(body.move)) {
    throw new ApiError(400, "INVALID_MOVE", "move must be ROCK, PAPER, or SCISSORS");
  }

  const result = submitQualRound(auth.agentId, qualMatchId, roundNo, body.move as Move);
  return NextResponse.json(result);
});
