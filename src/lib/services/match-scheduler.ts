/**
 * Match Scheduler — Phase timer + state machine transitions (PRD §4)
 *
 * Manages: READY_CHECK → COMMIT → REVEAL → RESULT → INTERVAL → next COMMIT ... → FINISHED
 * Resolution locks ensure each phase resolves exactly once.
 */

import { db } from "@/lib/server/in-memory-db";
import { AgentStatus, type Match, MatchStatus, type MatchPhase, Move, RoundOutcome, RoundPhase, RULES } from "@/types";
import { READY_CHECK_SEC, COMMIT_SEC, REVEAL_SEC, ROUND_INTERVAL_SEC, READY_FORFEIT_ELO } from "@/lib/config/timing";
import { processRound } from "@/lib/engine/game-engine";
import { checkMatchWinner } from "@/lib/engine/rules";
import { updateEloRatings, type EloDataProvider } from "@/lib/ranking/elo";
import { emitDomainEvent } from "./event-bus";
import { createHash } from "node:crypto";

// ─── Resolution Locks (PRD §4.9-4.10) ──────────────────
const resolvedReady = new Set<string>();
const resolvedRounds = new Set<string>();

// ─── Active timers ─────────────────────────────────────
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function timerKey(matchId: string, phase: string, round?: number): string {
  return `${matchId}:${phase}:${round ?? 0}`;
}

function clearTimer(matchId: string, phase: string, round?: number): void {
  const key = timerKey(matchId, phase, round);
  const timer = activeTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(key);
  }
}

function setTimer(matchId: string, phase: string, round: number | undefined, ms: number, handler: () => void): void {
  const key = timerKey(matchId, phase, round);
  clearTimer(matchId, phase, round);
  activeTimers.set(key, setTimeout(handler, ms));
}

// ─── ELO Provider ──────────────────────────────────────
const eloProvider: EloDataProvider = {
  async getCurrentRating(agentId: string): Promise<number | null> {
    const r = db.getCurrentEloRating(agentId);
    return r ? r.rating : null;
  },
  async getMatchCount(agentId: string): Promise<number> {
    return db.getEloMatchCount(agentId);
  },
};

// ─── Public API ────────────────────────────────────────

/**
 * Atomically resolve ready check. Returns true if this call performed the resolution.
 */
export function resolveReady(matchId: string): boolean {
  if (resolvedReady.has(matchId)) return false;
  resolvedReady.add(matchId);
  return true;
}

/**
 * Atomically resolve a round. Returns true if this call performed the resolution.
 */
export function resolveRound(matchId: string, roundNo: number): boolean {
  const key = `${matchId}:${roundNo}`;
  if (resolvedRounds.has(key)) return false;
  resolvedRounds.add(key);
  return true;
}

/**
 * Start the ready check phase for a newly created match.
 * Called by matchmaker after match creation.
 */
export function startReadyCheck(matchId: string): void {
  const match = db.getMatch(matchId);
  if (!match) return;

  const deadline = new Date(Date.now() + READY_CHECK_SEC * 1000);
  db.updateMatch({
    ...match,
    currentPhase: "READY_CHECK",
    phaseDeadline: deadline,
    readyDeadline: deadline,
  });

  // Update agent statuses to IN_MATCH
  const agentA = db.getAgent(match.agentA);
  const agentB = db.getAgent(match.agentB);
  if (agentA) db.updateAgent({ ...agentA, status: AgentStatus.IN_MATCH, updatedAt: new Date() });
  if (agentB) db.updateAgent({ ...agentB, status: AgentStatus.IN_MATCH, updatedAt: new Date() });

  setTimer(matchId, "READY_CHECK", undefined, READY_CHECK_SEC * 1000, () => {
    handleReadyTimeout(matchId);
  });
}

/**
 * Handle an agent marking ready. Returns updated match state.
 */
export function markReady(matchId: string, agentId: string): Match | null {
  const match = db.getMatch(matchId);
  if (!match || match.currentPhase !== "READY_CHECK") return null;

  const isA = agentId === match.agentA;
  const isB = agentId === match.agentB;
  if (!isA && !isB) return null;

  const updated = {
    ...match,
    readyA: isA ? true : match.readyA,
    readyB: isB ? true : match.readyB,
  };
  db.updateMatch(updated);

  // Both ready → transition to COMMIT
  if (updated.readyA && updated.readyB) {
    if (!resolveReady(matchId)) return db.getMatch(matchId);
    clearTimer(matchId, "READY_CHECK", undefined);
    return transitionToCommit(matchId, 1);
  }

  return updated;
}

/**
 * Called when both agents have committed. Transitions to REVEAL phase.
 */
export function transitionToReveal(matchId: string, roundNo: number): Match | null {
  const match = db.getMatch(matchId);
  if (!match) return null;

  clearTimer(matchId, "COMMIT", roundNo);
  const deadline = new Date(Date.now() + REVEAL_SEC * 1000);
  const updated = db.updateMatch({
    ...match,
    currentPhase: "REVEAL" as MatchPhase,
    phaseDeadline: deadline,
  });

  // Broadcast BOTH_COMMITTED
  db.appendEvents(matchId, [{
    type: "BOTH_COMMITTED",
    matchId,
    round: roundNo,
    revealDeadline: deadline.toISOString(),
  }]);

  setTimer(matchId, "REVEAL", roundNo, REVEAL_SEC * 1000, () => {
    handleRevealTimeout(matchId, roundNo);
  });

  return updated;
}

/**
 * Called after both agents reveal. Resolves the round.
 * Returns true if resolution happened, false if already resolved.
 */
export function handleBothRevealed(matchId: string, roundNo: number): boolean {
  if (!resolveRound(matchId, roundNo)) return false;
  clearTimer(matchId, "REVEAL", roundNo);

  const match = db.getMatch(matchId);
  if (!match) return false;

  // Get commits and reveals
  const commitA = db.getCommit(matchId, roundNo, match.agentA);
  const commitB = db.getCommit(matchId, roundNo, match.agentB);
  const revealA = db.getReveal(matchId, roundNo, match.agentA);
  const revealB = db.getReveal(matchId, roundNo, match.agentB);

  if (!revealA || !revealB) return false;

  const moveA = revealA.move;
  const moveB = revealB.move;

  // Process round using game engine
  const rounds = db.getRounds(matchId);
  const result = processRound(match, rounds, moveA, moveB);

  // Check prediction hits
  const predictionA = commitA?.prediction ?? null;
  const predictionB = commitB?.prediction ?? null;
  const predictionAHit = predictionA != null && predictionA === moveB;
  const predictionBHit = predictionB != null && predictionB === moveA;

  // Add prediction bonus to scores
  let bonusA = 0;
  let bonusB = 0;
  if (predictionAHit && result.round.outcome !== RoundOutcome.DRAW) bonusA = 1;
  if (predictionBHit && result.round.outcome !== RoundOutcome.DRAW) bonusB = 1;

  const finalRound = {
    ...result.round,
    pointsA: result.round.pointsA + bonusA,
    pointsB: result.round.pointsB + bonusB,
    readBonusA: predictionAHit,
    readBonusB: predictionBHit,
  };

  const finalMatch: Match = {
    ...result.updatedMatch,
    scoreA: result.updatedMatch.scoreA + bonusA,
    scoreB: result.updatedMatch.scoreB + bonusB,
    currentPhase: "RESULT" as MatchPhase,
  };

  // Re-check winner with bonuses
  const winnerId = checkMatchWinner(finalMatch);
  const isFinished = winnerId !== null || finalMatch.currentRound >= finalMatch.maxRounds;

  db.addRound(finalRound);

  if (isFinished) {
    const finishedMatch: Match = {
      ...finalMatch,
      status: MatchStatus.FINISHED,
      currentPhase: "FINISHED" as MatchPhase,
      winnerId: winnerId === "DRAW" ? null : winnerId,
      finishedAt: new Date(),
    };
    db.updateMatch(finishedMatch);

    // Emit ROUND_RESULT
    db.appendEvents(matchId, [{
      type: "ROUND_RESULT",
      matchId,
      roundNo,
      outcome: finalRound.outcome!,
      pointsA: finalRound.pointsA,
      pointsB: finalRound.pointsB,
      readBonusA: finalRound.readBonusA,
      readBonusB: finalRound.readBonusB,
      scoreA: finishedMatch.scoreA,
      scoreB: finishedMatch.scoreB,
      moveA,
      moveB,
      predictionBonusA: predictionAHit,
      predictionBonusB: predictionBHit,
      winner: finalRound.outcome === RoundOutcome.WIN_A ? match.agentA :
              finalRound.outcome === RoundOutcome.WIN_B ? match.agentB : null,
    }]);

    // Finish match
    finishMatch(finishedMatch);
  } else {
    db.updateMatch(finalMatch);

    // Emit ROUND_RESULT
    db.appendEvents(matchId, [{
      type: "ROUND_RESULT",
      matchId,
      roundNo,
      outcome: finalRound.outcome!,
      pointsA: finalRound.pointsA,
      pointsB: finalRound.pointsB,
      readBonusA: finalRound.readBonusA,
      readBonusB: finalRound.readBonusB,
      scoreA: finalMatch.scoreA,
      scoreB: finalMatch.scoreB,
      moveA,
      moveB,
      predictionBonusA: predictionAHit,
      predictionBonusB: predictionBHit,
      winner: finalRound.outcome === RoundOutcome.WIN_A ? match.agentA :
              finalRound.outcome === RoundOutcome.WIN_B ? match.agentB : null,
    }]);

    // Schedule interval → next round
    scheduleNextRound(matchId, roundNo + 1);
  }

  return true;
}

/**
 * Handle hash mismatch — agent loses the round.
 */
export function handleHashMismatch(matchId: string, roundNo: number, cheaterAgentId: string): boolean {
  if (!resolveRound(matchId, roundNo)) return false;
  clearTimer(matchId, "REVEAL", roundNo);

  const match = db.getMatch(matchId);
  if (!match) return false;

  const isCheaterA = cheaterAgentId === match.agentA;
  const outcome = isCheaterA ? RoundOutcome.FORFEIT_A : RoundOutcome.FORFEIT_B;
  const pointsA = isCheaterA ? 0 : 1;
  const pointsB = isCheaterA ? 1 : 0;

  const round = {
    id: `round_mismatch_${matchId}_${roundNo}`,
    matchId,
    roundNo,
    phase: RoundPhase.PUBLISHED,
    moveA: null as Move | null,
    moveB: null as Move | null,
    outcome,
    pointsA,
    pointsB,
    readBonusA: false,
    readBonusB: false,
    violationA: isCheaterA ? "HASH_MISMATCH" : null,
    violationB: isCheaterA ? null : "HASH_MISMATCH",
    judgedAt: new Date(),
    createdAt: new Date(),
  };
  db.addRound(round);

  const updated: Match = {
    ...match,
    scoreA: match.scoreA + pointsA,
    scoreB: match.scoreB + pointsB,
    winsA: match.winsA + (isCheaterA ? 0 : 1),
    winsB: match.winsB + (isCheaterA ? 1 : 0),
    currentRound: roundNo,
    currentPhase: "RESULT" as MatchPhase,
  };

  const winnerId = checkMatchWinner(updated);
  const isFinished = winnerId !== null || updated.currentRound >= updated.maxRounds;

  if (isFinished) {
    const finishedMatch: Match = {
      ...updated,
      status: MatchStatus.FINISHED,
      currentPhase: "FINISHED" as MatchPhase,
      winnerId: winnerId === "DRAW" ? null : winnerId,
      finishedAt: new Date(),
    };
    db.updateMatch(finishedMatch);
    finishMatch(finishedMatch);
  } else {
    db.updateMatch(updated);
    scheduleNextRound(matchId, roundNo + 1);
  }

  return true;
}

// ─── Internal helpers ──────────────────────────────────

function transitionToCommit(matchId: string, roundNo: number): Match {
  const match = db.getMatch(matchId)!;
  const deadline = new Date(Date.now() + COMMIT_SEC * 1000);
  const updated = db.updateMatch({
    ...match,
    status: MatchStatus.RUNNING,
    currentPhase: "COMMIT" as MatchPhase,
    currentRound: roundNo,
    phaseDeadline: deadline,
  });

  // Emit appropriate event
  if (roundNo === 1) {
    db.appendEvents(matchId, [{
      type: "MATCH_START",
      matchId,
      round: roundNo,
      commitDeadline: deadline.toISOString(),
    }]);
  } else {
    db.appendEvents(matchId, [{
      type: "ROUND_START",
      matchId,
      round: roundNo,
      commitDeadline: deadline.toISOString(),
    }]);
  }

  setTimer(matchId, "COMMIT", roundNo, COMMIT_SEC * 1000, () => {
    handleCommitTimeout(matchId, roundNo);
  });

  return updated;
}

function scheduleNextRound(matchId: string, nextRoundNo: number): void {
  const match = db.getMatch(matchId);
  if (!match) return;

  db.updateMatch({
    ...match,
    currentPhase: "INTERVAL" as MatchPhase,
    phaseDeadline: new Date(Date.now() + ROUND_INTERVAL_SEC * 1000),
  });

  setTimer(matchId, "INTERVAL", nextRoundNo, ROUND_INTERVAL_SEC * 1000, () => {
    transitionToCommit(matchId, nextRoundNo);
  });
}

function handleReadyTimeout(matchId: string): void {
  if (!resolveReady(matchId)) return;

  const match = db.getMatch(matchId);
  if (!match || match.currentPhase !== "READY_CHECK") return;

  const now = new Date();

  // Apply penalties per PRD §4.1
  if (match.readyA && !match.readyB) {
    // B forfeits
    applyReadyForfeit(match.agentB);
  } else if (!match.readyA && match.readyB) {
    // A forfeits
    applyReadyForfeit(match.agentA);
  }
  // Both not ready → no penalty

  // Both agents → QUALIFIED
  const agentA = db.getAgent(match.agentA);
  const agentB = db.getAgent(match.agentB);
  if (agentA) db.updateAgent({ ...agentA, status: AgentStatus.QUALIFIED, updatedAt: now });
  if (agentB) db.updateAgent({ ...agentB, status: AgentStatus.QUALIFIED, updatedAt: now });

  // Match → FINISHED with no winner
  db.updateMatch({
    ...match,
    status: MatchStatus.FINISHED,
    currentPhase: "FINISHED" as MatchPhase,
    winnerId: null,
    finishedAt: now,
  });

  db.appendEvents(matchId, [{
    type: "READY_TIMEOUT",
    matchId,
    readyA: match.readyA,
    readyB: match.readyB,
  }]);

  emitDomainEvent({ type: "READY_TIMEOUT", matchId });
}

function applyReadyForfeit(agentId: string): void {
  const agent = db.getAgent(agentId);
  if (!agent) return;

  // Direct ELO -15 penalty (not Elo formula)
  const currentRating = db.getCurrentEloRating(agentId);
  const currentElo = currentRating?.rating ?? agent.elo;
  db.addEloRating({
    id: `elo_forfeit_${agentId}_${Date.now()}`,
    agentId,
    rating: currentElo + READY_FORFEIT_ELO,
    matchId: "ready_forfeit",
    delta: READY_FORFEIT_ELO,
    updatedAt: new Date(),
  });

  db.updateAgent({
    ...agent,
    elo: currentElo + READY_FORFEIT_ELO,
    consecutiveTimeouts: agent.consecutiveTimeouts + 1,
    updatedAt: new Date(),
  });
}

function handleCommitTimeout(matchId: string, roundNo: number): void {
  if (!resolveRound(matchId, roundNo)) return;

  const match = db.getMatch(matchId);
  if (!match) return;

  const commitA = db.getCommit(matchId, roundNo, match.agentA);
  const commitB = db.getCommit(matchId, roundNo, match.agentB);

  let outcome: RoundOutcome;
  let pointsA = 0;
  let pointsB = 0;

  if (commitA && !commitB) {
    outcome = RoundOutcome.FORFEIT_B;
    pointsA = 1;
  } else if (!commitA && commitB) {
    outcome = RoundOutcome.FORFEIT_A;
    pointsB = 1;
  } else {
    // Both timeout or both committed (shouldn't be timeout if both committed)
    outcome = RoundOutcome.DRAW;
  }

  const round = {
    id: `round_timeout_${matchId}_${roundNo}`,
    matchId,
    roundNo,
    phase: RoundPhase.PUBLISHED,
    moveA: null as Move | null,
    moveB: null as Move | null,
    outcome,
    pointsA,
    pointsB,
    readBonusA: false,
    readBonusB: false,
    violationA: !commitA ? "COMMIT_TIMEOUT" : null,
    violationB: !commitB ? "COMMIT_TIMEOUT" : null,
    judgedAt: new Date(),
    createdAt: new Date(),
  };
  db.addRound(round);

  const updated: Match = {
    ...match,
    scoreA: match.scoreA + pointsA,
    scoreB: match.scoreB + pointsB,
    winsA: match.winsA + (outcome === RoundOutcome.FORFEIT_B ? 1 : 0),
    winsB: match.winsB + (outcome === RoundOutcome.FORFEIT_A ? 1 : 0),
    currentRound: roundNo,
    currentPhase: "RESULT" as MatchPhase,
  };

  const winnerId = checkMatchWinner(updated);
  const isFinished = winnerId !== null || updated.currentRound >= updated.maxRounds;

  if (isFinished) {
    const finishedMatch: Match = {
      ...updated,
      status: MatchStatus.FINISHED,
      currentPhase: "FINISHED" as MatchPhase,
      winnerId: winnerId === "DRAW" ? null : winnerId,
      finishedAt: new Date(),
    };
    db.updateMatch(finishedMatch);
    finishMatch(finishedMatch);
  } else {
    db.updateMatch(updated);
    scheduleNextRound(matchId, roundNo + 1);
  }
}

function handleRevealTimeout(matchId: string, roundNo: number): void {
  if (!resolveRound(matchId, roundNo)) return;

  const match = db.getMatch(matchId);
  if (!match) return;

  const revealA = db.getReveal(matchId, roundNo, match.agentA);
  const revealB = db.getReveal(matchId, roundNo, match.agentB);

  let outcome: RoundOutcome;
  let pointsA = 0;
  let pointsB = 0;

  if (revealA?.verified && !revealB?.verified) {
    outcome = RoundOutcome.FORFEIT_B;
    pointsA = 1;
  } else if (!revealA?.verified && revealB?.verified) {
    outcome = RoundOutcome.FORFEIT_A;
    pointsB = 1;
  } else {
    outcome = RoundOutcome.DRAW;
  }

  const round = {
    id: `round_reveal_timeout_${matchId}_${roundNo}`,
    matchId,
    roundNo,
    phase: RoundPhase.PUBLISHED,
    moveA: revealA?.move ?? null,
    moveB: revealB?.move ?? null,
    outcome,
    pointsA,
    pointsB,
    readBonusA: false,
    readBonusB: false,
    violationA: !revealA?.verified ? "REVEAL_TIMEOUT" : null,
    violationB: !revealB?.verified ? "REVEAL_TIMEOUT" : null,
    judgedAt: new Date(),
    createdAt: new Date(),
  };
  db.addRound(round);

  const updated: Match = {
    ...match,
    scoreA: match.scoreA + pointsA,
    scoreB: match.scoreB + pointsB,
    winsA: match.winsA + (outcome === RoundOutcome.FORFEIT_B ? 1 : 0),
    winsB: match.winsB + (outcome === RoundOutcome.FORFEIT_A ? 1 : 0),
    currentRound: roundNo,
    currentPhase: "RESULT" as MatchPhase,
  };

  const winnerId = checkMatchWinner(updated);
  const isFinished = winnerId !== null || updated.currentRound >= updated.maxRounds;

  if (isFinished) {
    const finishedMatch: Match = {
      ...updated,
      status: MatchStatus.FINISHED,
      currentPhase: "FINISHED" as MatchPhase,
      winnerId: winnerId === "DRAW" ? null : winnerId,
      finishedAt: new Date(),
    };
    db.updateMatch(finishedMatch);
    finishMatch(finishedMatch);
  } else {
    db.updateMatch(updated);
    scheduleNextRound(matchId, roundNo + 1);
  }
}

/**
 * Atomically finalize a match (PRD §4.8): status, agent states, ELO — one logical operation.
 * Synchronous for status + agent transitions; ELO update is async but applied atomically.
 */
function finishMatch(match: Match): void {
  const now = new Date();

  // Step 1: Synchronously set agent status → POST_MATCH and match status
  const agentA = db.getAgent(match.agentA);
  const agentB = db.getAgent(match.agentB);
  if (agentA) db.updateAgent({ ...agentA, status: AgentStatus.POST_MATCH, updatedAt: now });
  if (agentB) db.updateAgent({ ...agentB, status: AgentStatus.POST_MATCH, updatedAt: now });

  // Step 2: Attempt ELO update (async, but we apply results synchronously via .then)
  updateEloRatings(match, eloProvider).then(({ ratingA, ratingB }) => {
    db.addEloRating(ratingA);
    db.addEloRating(ratingB);

    // Update agents with new ELO
    const freshA = db.getAgent(match.agentA);
    const freshB = db.getAgent(match.agentB);
    if (freshA) db.updateAgent({ ...freshA, elo: ratingA.rating, updatedAt: new Date() });
    if (freshB) db.updateAgent({ ...freshB, elo: ratingB.rating, updatedAt: new Date() });

    // Atomic: write ELO changes to match
    db.updateMatch({
      ...db.getMatch(match.id)!,
      eloChangeA: ratingA.delta,
      eloChangeB: ratingB.delta,
      eloUpdatedAt: new Date(),
    });
  }).catch(() => {
    // ELO calculation failed — set null, retry in 5s
    db.updateMatch({
      ...db.getMatch(match.id)!,
      eloChangeA: null,
      eloChangeB: null,
      eloUpdatedAt: null,
    });
    setTimeout(() => retryEloUpdate(match.id), 5000);
  });

  // Emit MATCH_FINISHED event (synchronous, uses current match state)
  db.appendEvents(match.id, [{
    type: "MATCH_FINISHED",
    matchId: match.id,
    winnerId: match.winnerId,
    finalScoreA: match.scoreA,
    finalScoreB: match.scoreB,
    eloChangeA: match.eloChangeA,
    eloChangeB: match.eloChangeB,
  }]);

  emitDomainEvent({ type: "MATCH_FINISHED", matchId: match.id });
}

async function retryEloUpdate(matchId: string): Promise<void> {
  const match = db.getMatch(matchId);
  if (!match || match.eloUpdatedAt) return; // Already updated

  try {
    const { ratingA, ratingB } = await updateEloRatings(match, eloProvider);
    db.addEloRating(ratingA);
    db.addEloRating(ratingB);

    const agentA = db.getAgent(match.agentA);
    const agentB = db.getAgent(match.agentB);
    const now = new Date();
    if (agentA) db.updateAgent({ ...agentA, elo: ratingA.rating, updatedAt: now });
    if (agentB) db.updateAgent({ ...agentB, elo: ratingB.rating, updatedAt: now });

    db.updateMatch({
      ...db.getMatch(matchId)!,
      eloChangeA: ratingA.delta,
      eloChangeB: ratingB.delta,
      eloUpdatedAt: now,
    });
  } catch {
    // Silent failure on retry
  }
}

/**
 * Reset all scheduler state (for testing).
 */
export function resetScheduler(): void {
  for (const timer of activeTimers.values()) {
    clearTimeout(timer);
  }
  activeTimers.clear();
  resolvedReady.clear();
  resolvedRounds.clear();
}
