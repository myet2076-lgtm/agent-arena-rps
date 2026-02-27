/**
 * GET /api/rules — Game rules (PRD F06)
 */

import { NextResponse } from "next/server";
import { COMMIT_SEC, READY_CHECK_SEC, REVEAL_SEC, ROUND_INTERVAL_SEC } from "@/lib/config/timing";
import { RULES } from "@/types";
import type { RulesResponse } from "@/types/api";

export async function GET(): Promise<NextResponse<RulesResponse>> {
  return NextResponse.json({
    format: RULES.FORMAT,
    winScore: RULES.WIN_THRESHOLD,
    maxRounds: RULES.MAX_ROUNDS,
    scoring: {
      normalWin: RULES.NORMAL_WIN_POINTS,
      predictionBonus: RULES.READ_BONUS_POINTS,
      draw: 0,
      timeout: 0,
    },
    timeouts: {
      commitSec: COMMIT_SEC,
      revealSec: REVEAL_SEC,
      roundIntervalSec: ROUND_INTERVAL_SEC,
      readyCheckSec: READY_CHECK_SEC,
    },
    moves: ["ROCK", "PAPER", "SCISSORS"],
    hashFormat: "sha256({MOVE}:{SALT})",
  });
}
