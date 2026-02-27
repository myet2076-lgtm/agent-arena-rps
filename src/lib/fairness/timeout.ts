import { CommitRecord, GameEvent, Round, RoundOutcome, RoundPhase } from "@/types";

/**
 * Returns true when commit phase has timed out.
 */
export function checkCommitTimeout(commitRecord: CommitRecord, now: Date): boolean {
  if (!commitRecord?.expiresAt) {
    throw new Error("commitRecord.expiresAt is required.");
  }

  return now.getTime() > commitRecord.expiresAt.getTime();
}

/**
 * Returns true when reveal deadline has passed.
 */
export function checkRevealTimeout(revealDeadline: Date, now: Date): boolean {
  if (!revealDeadline) {
    throw new Error("revealDeadline is required.");
  }

  return now.getTime() > revealDeadline.getTime();
}

function inferForfeitOutcome(timedOutAgentId: string): RoundOutcome {
  const normalized = timedOutAgentId.trim().toUpperCase();
  const indicatesBoth =
    normalized === "BOTH" ||
    normalized === "A&B" ||
    normalized === "A,B" ||
    normalized === "AB";

  if (indicatesBoth) return RoundOutcome.DRAW;

  const indicatesA =
    normalized === "A" ||
    normalized.endsWith(":A") ||
    normalized.endsWith("_A") ||
    normalized.endsWith("-A");

  return indicatesA ? RoundOutcome.FORFEIT_A : RoundOutcome.FORFEIT_B;
}

/**
 * Creates a timeout-forfeit round snapshot and corresponding event payload.
 */
export function handleTimeout(
  matchId: string,
  roundNo: number,
  timedOutAgentId: string,
  currentScoreA = 0,
  currentScoreB = 0,
): { round: Round; events: GameEvent[] } {
  if (!matchId) throw new Error("matchId is required.");
  if (roundNo <= 0) throw new Error("roundNo must be a positive integer.");
  if (!timedOutAgentId) throw new Error("timedOutAgentId is required.");

  const now = new Date();
  const outcome = inferForfeitOutcome(timedOutAgentId);
  const pointsA = outcome === RoundOutcome.FORFEIT_B ? 1 : 0;
  const pointsB = outcome === RoundOutcome.FORFEIT_A ? 1 : 0;

  const round: Round = {
    id: `round_timeout_${matchId}_${roundNo}`,
    matchId,
    roundNo,
    phase: RoundPhase.PUBLISHED,
    moveA: null,
    moveB: null,
    outcome,
    pointsA,
    pointsB,
    predictionBonusA: false,
    predictionBonusB: false,
    violationA: outcome === RoundOutcome.FORFEIT_A || outcome === RoundOutcome.DRAW ? "TIMEOUT" : null,
    violationB: outcome === RoundOutcome.FORFEIT_B || outcome === RoundOutcome.DRAW ? "TIMEOUT" : null,
    judgedAt: now,
    createdAt: now,
  };

  const event: GameEvent = {
    type: "ROUND_RESULT",
    matchId,
    roundNo,
    outcome,
    pointsA,
    pointsB,
    predictionBonusA: false,
    predictionBonusB: false,
    scoreA: currentScoreA + pointsA,
    scoreB: currentScoreB + pointsB,
  };

  return { round, events: [event] };
}
