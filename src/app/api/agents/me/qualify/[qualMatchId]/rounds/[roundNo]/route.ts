/**
 * POST /api/agents/me/qualify/{qualMatchId}/rounds/{roundNo} — Submit round move
 */

import { NextResponse } from "next/server";
import { authenticateByKey } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/api-error";
import { submitQualRound } from "@/lib/services/qual-service";
import { Move } from "@/types";

const VALID_MOVES = new Set(["ROCK", "PAPER", "SCISSORS"]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ qualMatchId: string; roundNo: string }> },
): Promise<NextResponse> {
  try {
    const auth = authenticateByKey(req);
    if (!auth.valid) throw new ApiError(401, "UNAUTHORIZED", auth.error);

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
  } catch (err) {
    if (err instanceof ApiError) return err.toResponse();
    console.error("[API Error]", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
