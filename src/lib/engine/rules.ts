import { Match, Move, Round, RoundOutcome, RULES } from "@/types";

/**
 * Decides winner for a single Rock-Paper-Scissors reveal pair.
 */
export function getWinner(moveA: Move, moveB: Move): RoundOutcome {
  if (moveA === moveB) return RoundOutcome.DRAW;

  const aWins =
    (moveA === Move.ROCK && moveB === Move.SCISSORS) ||
    (moveA === Move.PAPER && moveB === Move.ROCK) ||
    (moveA === Move.SCISSORS && moveB === Move.PAPER);

  return aWins ? RoundOutcome.WIN_A : RoundOutcome.WIN_B;
}

/**
 * Returns true if currentMove beats opponent's previous move.
 */
export function isPredictionBonusHit(currentMove: Move, opponentPreviousMove: Move | null): boolean {
  if (!opponentPreviousMove) return false;

  return (
    (currentMove === Move.ROCK && opponentPreviousMove === Move.SCISSORS) ||
    (currentMove === Move.PAPER && opponentPreviousMove === Move.ROCK) ||
    (currentMove === Move.SCISSORS && opponentPreviousMove === Move.PAPER)
  );
}

/**
 * Validates move-use and consecutive-use constraints for a given move history.
 */
export function validateMove(
  move: Move,
  moveHistory: Move[],
  rules: Pick<typeof RULES, "MOVE_USE_LIMIT" | "CONSECUTIVE_LIMIT"> = RULES,
): { valid: boolean; violation: string | null } {
  const usedCount = moveHistory.filter((m) => m === move).length;
  if (usedCount >= rules.MOVE_USE_LIMIT) {
    return { valid: false, violation: "MOVE_USE_LIMIT" };
  }

  const recent = moveHistory.slice(-(rules.CONSECUTIVE_LIMIT - 1));
  const wouldBreakConsecutive =
    recent.length === rules.CONSECUTIVE_LIMIT - 1 && recent.every((m) => m === move);

  if (wouldBreakConsecutive) {
    return { valid: false, violation: "CONSECUTIVE_LIMIT" };
  }

  return { valid: true, violation: null };
}

/**
 * Checks if a match has a winner using points-first policy.
 *
 * Return values:
 * - agentA id / agentB id when winner is decided
 * - "DRAW" when max rounds reached and all tiebreakers are tied
 * - null when match should continue
 */
export function checkMatchWinner(match: Match): string | null {
  const threshold = RULES.WIN_THRESHOLD;

  // Priority: when both sides hit threshold in the same state update,
  // resolve via score first, then wins tiebreaker, then draw.
  if (match.scoreA >= threshold && match.scoreB >= threshold) {
    if (match.scoreA > match.scoreB) return match.agentA;
    if (match.scoreB > match.scoreA) return match.agentB;
    if (match.winsA > match.winsB) return match.agentA;
    if (match.winsB > match.winsA) return match.agentB;
    return "DRAW";
  } else if (match.scoreA >= threshold) {
    if (match.scoreA > match.scoreB) return match.agentA;
  } else if (match.scoreB >= threshold) {
    if (match.scoreB > match.scoreA) return match.agentB;
  }

  if (match.currentRound >= match.maxRounds) {
    if (match.scoreA > match.scoreB) return match.agentA;
    if (match.scoreB > match.scoreA) return match.agentB;
    if (match.winsA > match.winsB) return match.agentA;
    if (match.winsB > match.winsA) return match.agentB;
    return "DRAW";
  }

  return null;
}

/**
 * Utility for extracting one agent's move history from rounds.
 */
export function getMoveHistory(rounds: Round[], side: "A" | "B"): Move[] {
  return rounds
    .map((round) => (side === "A" ? round.moveA : round.moveB))
    .filter((m): m is Move => m !== null);
}
