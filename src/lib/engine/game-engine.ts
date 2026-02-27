import {
  GameEvent,
  Match,
  MatchStatus,
  Move,
  Round,
  RoundOutcome,
  RoundPhase,
  RULES,
} from "@/types";
import { checkMatchWinner, getMoveHistory, getWinner, isReadBonus, validateMove } from "./rules";

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/**
 * Creates a new match in CREATED state.
 */
export function createMatch(agentA: string, agentB: string, seasonId: string): Match {
  if (agentA === agentB) {
    throw new Error("agentA and agentB must be different agents.");
  }

  const now = new Date();

  return {
    id: createId("match"),
    seasonId,
    agentA,
    agentB,
    status: MatchStatus.CREATED,
    format: RULES.FORMAT,
    scoreA: 0,
    scoreB: 0,
    winsA: 0,
    winsB: 0,
    currentRound: 0,
    maxRounds: RULES.MAX_ROUNDS,
    winnerId: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    readyA: false,
    readyB: false,
    readyDeadline: null,
    currentPhase: "READY_CHECK" as Match["currentPhase"],
    phaseDeadline: null,
    eloChangeA: null,
    eloChangeB: null,
    eloUpdatedAt: null,
  };
}

/**
 * Processes a fully revealed round and returns immutable next state.
 */
export function processRound(
  match: Match,
  rounds: Round[],
  moveA: Move,
  moveB: Move,
): { round: Round; updatedMatch: Match; events: GameEvent[] } {
  if (match.status === MatchStatus.FINISHED || match.status === MatchStatus.ARCHIVED) {
    throw new Error(`Cannot process round for match in status ${match.status}.`);
  }

  if (rounds.length >= match.maxRounds) {
    throw new Error("Cannot process round: max rounds already reached.");
  }

  const events: GameEvent[] = [];
  const now = new Date();
  const roundNo = rounds.length + 1;

  const updatedMatchStart: Match =
    match.status === MatchStatus.CREATED
      ? { ...match, status: MatchStatus.RUNNING, startedAt: now }
      : { ...match };

  if (match.status === MatchStatus.CREATED) {
    events.push({
      type: "MATCH_STARTED",
      matchId: match.id,
      agentA: match.agentA,
      agentB: match.agentB,
    });
  }

  const moveHistoryA = getMoveHistory(rounds, "A");
  const moveHistoryB = getMoveHistory(rounds, "B");

  const validationA = validateMove(moveA, moveHistoryA, RULES);
  const validationB = validateMove(moveB, moveHistoryB, RULES);

  let outcome: RoundOutcome;
  let readBonusA = false;
  let readBonusB = false;
  let pointsA = 0;
  let pointsB = 0;

  if (!validationA.valid && validationB.valid) {
    outcome = RoundOutcome.FORFEIT_A;
    pointsB = RULES.NORMAL_WIN_POINTS;
  } else if (validationA.valid && !validationB.valid) {
    outcome = RoundOutcome.FORFEIT_B;
    pointsA = RULES.NORMAL_WIN_POINTS;
  } else if (!validationA.valid && !validationB.valid) {
    outcome = RoundOutcome.DRAW;
  } else {
    outcome = getWinner(moveA, moveB);

    const prevRound = rounds[rounds.length - 1];
    const prevMoveA = prevRound?.moveA ?? null;
    const prevMoveB = prevRound?.moveB ?? null;

    if (outcome === RoundOutcome.WIN_A) {
      readBonusA = isReadBonus(moveA, prevMoveB);
      pointsA = readBonusA ? RULES.READ_BONUS_POINTS : RULES.NORMAL_WIN_POINTS;
    }

    if (outcome === RoundOutcome.WIN_B) {
      readBonusB = isReadBonus(moveB, prevMoveA);
      pointsB = readBonusB ? RULES.READ_BONUS_POINTS : RULES.NORMAL_WIN_POINTS;
    }
  }

  const round: Round = {
    id: createId(`round_${match.id}_${roundNo}`),
    matchId: match.id,
    roundNo,
    phase: RoundPhase.PUBLISHED,
    moveA,
    moveB,
    outcome,
    pointsA,
    pointsB,
    readBonusA,
    readBonusB,
    violationA: validationA.violation,
    violationB: validationB.violation,
    judgedAt: now,
    createdAt: now,
  };

  const winsAInc = outcome === RoundOutcome.WIN_A || outcome === RoundOutcome.FORFEIT_B ? 1 : 0;
  const winsBInc = outcome === RoundOutcome.WIN_B || outcome === RoundOutcome.FORFEIT_A ? 1 : 0;

  const progressedMatch: Match = {
    ...updatedMatchStart,
    scoreA: updatedMatchStart.scoreA + pointsA,
    scoreB: updatedMatchStart.scoreB + pointsB,
    winsA: updatedMatchStart.winsA + winsAInc,
    winsB: updatedMatchStart.winsB + winsBInc,
    currentRound: roundNo,
  };

  const winnerId = checkMatchWinner(progressedMatch);
  const finished = winnerId !== null;

  const updatedMatch: Match = finished
    ? {
        ...progressedMatch,
        status: MatchStatus.FINISHED,
        winnerId: winnerId === "DRAW" ? null : winnerId,
        finishedAt: now,
      }
    : progressedMatch;

  events.push({
    type: "ROUND_RESULT",
    matchId: match.id,
    roundNo,
    outcome,
    pointsA,
    pointsB,
    readBonusA,
    readBonusB,
    scoreA: updatedMatch.scoreA,
    scoreB: updatedMatch.scoreB,
  });

  if (finished) {
    events.push({
      type: "MATCH_FINISHED",
      matchId: match.id,
      winnerId: winnerId === "DRAW" ? null : winnerId,
      finalScoreA: updatedMatch.scoreA,
      finalScoreB: updatedMatch.scoreB,
    });
  }

  return { round, updatedMatch, events };
}
