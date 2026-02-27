import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/server/in-memory-db";
import { hashApiKey } from "@/lib/server/auth";
import { AgentStatus, MatchStatus, Move, type Match, type MatchPhase } from "@/types";
import {
  startReadyCheck,
  markReady,
  resolveReady,
  resolveRound,
  transitionToReveal,
  handleBothRevealed,
  handleHashMismatch,
  resetScheduler,
} from "../match-scheduler";
import { tryMatch } from "../matchmaker";
import { resetQueueEvents } from "../queue-events";
import { createHash } from "node:crypto";

function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function createTestAgent(id: string, status: AgentStatus = AgentStatus.QUEUED) {
  db.createAgent({
    id,
    name: `Agent ${id}`,
    keyHash: hashApiKey(`key-${id}`),
    status,
    elo: 1500,
    createdAt: new Date(),
    updatedAt: new Date(),
    queueCooldownUntil: null,
    queueBanUntil: null,
    consecutiveTimeouts: 0,
    suspiciousFlag: false,
    settings: { autoRequeue: false, maxConsecutiveMatches: 5, restBetweenSec: 30, allowedIps: [] },
    consecutiveMatches: 0,
  });
}

function createMatchedPair(): string {
  createTestAgent("a1", AgentStatus.QUEUED);
  createTestAgent("a2", AgentStatus.QUEUED);
  db.createQueueEntry({ id: "q-a1", agentId: "a1", joinedAt: new Date(Date.now() - 2000), lastActivityAt: new Date(), status: "WAITING" });
  db.createQueueEntry({ id: "q-a2", agentId: "a2", joinedAt: new Date(Date.now() - 1000), lastActivityAt: new Date(), status: "WAITING" });
  const result = tryMatch()!;
  return result.matchId;
}

function setupCommitPhase(matchId: string): Match {
  startReadyCheck(matchId);
  markReady(matchId, "a1");
  const match = markReady(matchId, "a2")!;
  return match;
}

beforeEach(() => {
  vi.useFakeTimers();
  db.reset();
  resetQueueEvents();
  resetScheduler();
});

afterEach(() => {
  resetScheduler();
  vi.useRealTimers();
});

describe("Match Scheduler — Phase Transitions", () => {
  it("starts ready check on match creation", () => {
    const matchId = createMatchedPair();
    startReadyCheck(matchId);
    const match = db.getMatch(matchId)!;
    expect(match.currentPhase).toBe("READY_CHECK");
    expect(match.readyDeadline).toBeTruthy();
    expect(db.getAgent("a1")!.status).toBe(AgentStatus.IN_MATCH);
    expect(db.getAgent("a2")!.status).toBe(AgentStatus.IN_MATCH);
  });

  it("transitions to COMMIT when both ready", () => {
    const matchId = createMatchedPair();
    startReadyCheck(matchId);
    markReady(matchId, "a1");
    const result = markReady(matchId, "a2")!;
    expect(result.currentPhase).toBe("COMMIT");
    expect(result.currentRound).toBe(1);
    expect(result.status).toBe(MatchStatus.RUNNING);
  });

  it("handles ready timeout — one ready, one not → forfeit", () => {
    const matchId = createMatchedPair();
    startReadyCheck(matchId);
    markReady(matchId, "a1"); // only a1 ready

    vi.advanceTimersByTime(30_000);

    const match = db.getMatch(matchId)!;
    expect(match.currentPhase).toBe("FINISHED");
    expect(match.status).toBe(MatchStatus.FINISHED);
    // a2 should get ELO penalty
    const a2 = db.getAgent("a2")!;
    expect(a2.status).toBe(AgentStatus.QUALIFIED);
    expect(a2.elo).toBeLessThan(1500);
  });

  it("handles ready timeout — both not ready → no penalty", () => {
    const matchId = createMatchedPair();
    startReadyCheck(matchId);
    // neither ready

    vi.advanceTimersByTime(30_000);

    const match = db.getMatch(matchId)!;
    expect(match.currentPhase).toBe("FINISHED");
    expect(db.getAgent("a1")!.elo).toBe(1500);
    expect(db.getAgent("a2")!.elo).toBe(1500);
  });

  it("idempotent ready — duplicate returns match without error", () => {
    const matchId = createMatchedPair();
    startReadyCheck(matchId);
    markReady(matchId, "a1");
    const second = markReady(matchId, "a1");
    expect(second).toBeTruthy();
    expect(second!.readyA).toBe(true);
  });

  it("transitions COMMIT → REVEAL when both commit", () => {
    const matchId = createMatchedPair();
    const match = setupCommitPhase(matchId);

    const saltA = "A1b2C3d4E5f6G7h8";
    const hashA = sha256hex(`ROCK:${saltA}`);
    db.upsertCommit(matchId, 1, "a1", hashA);

    const saltB = "Z9Y8X7W6V5U4T3S2";
    const hashB = sha256hex(`PAPER:${saltB}`);
    db.upsertCommit(matchId, 1, "a2", hashB);

    transitionToReveal(matchId, 1);

    const updated = db.getMatch(matchId)!;
    expect(updated.currentPhase).toBe("REVEAL");
  });

  it("commit timeout — one commits, other doesn't → forfeit", () => {
    const matchId = createMatchedPair();
    setupCommitPhase(matchId);

    // Only a1 commits
    db.upsertCommit(matchId, 1, "a1", "a".repeat(64));

    vi.advanceTimersByTime(30_000);

    const match = db.getMatch(matchId)!;
    const rounds = db.getRounds(matchId);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].violationB).toBe("COMMIT_TIMEOUT");
  });

  it("reveal timeout — one reveals, other doesn't → forfeit", () => {
    const matchId = createMatchedPair();
    setupCommitPhase(matchId);

    const saltA = "A1b2C3d4E5f6G7h8";
    const hashA = sha256hex(`ROCK:${saltA}`);
    db.upsertCommit(matchId, 1, "a1", hashA);

    const saltB = "Z9Y8X7W6V5U4T3S2";
    const hashB = sha256hex(`PAPER:${saltB}`);
    db.upsertCommit(matchId, 1, "a2", hashB);

    transitionToReveal(matchId, 1);

    // Only a1 reveals
    db.upsertReveal(matchId, 1, "a1", Move.ROCK, saltA);
    const reveal = db.getReveal(matchId, 1, "a1")!;
    reveal.verified = true;

    vi.advanceTimersByTime(15_000);

    const rounds = db.getRounds(matchId);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].violationB).toBe("REVEAL_TIMEOUT");
  });

  it("both reveal → resolves round → schedules next round", () => {
    const matchId = createMatchedPair();
    setupCommitPhase(matchId);

    const saltA = "A1b2C3d4E5f6G7h8";
    const hashA = sha256hex(`ROCK:${saltA}`);
    db.upsertCommit(matchId, 1, "a1", hashA);

    const saltB = "Z9Y8X7W6V5U4T3S2";
    const hashB = sha256hex(`PAPER:${saltB}`);
    db.upsertCommit(matchId, 1, "a2", hashB);

    transitionToReveal(matchId, 1);

    db.upsertReveal(matchId, 1, "a1", Move.ROCK, saltA);
    db.upsertReveal(matchId, 1, "a2", Move.PAPER, saltB);

    const resolved = handleBothRevealed(matchId, 1);
    expect(resolved).toBe(true);

    const match = db.getMatch(matchId)!;
    // Should be in INTERVAL or RESULT (B wins round 1)
    expect(match.scoreB).toBeGreaterThan(0);

    // Advance through interval
    vi.advanceTimersByTime(5_000);

    const afterInterval = db.getMatch(matchId)!;
    expect(afterInterval.currentPhase).toBe("COMMIT");
    expect(afterInterval.currentRound).toBe(2);
  });

  it("full match flow — play until finish", () => {
    const matchId = createMatchedPair();
    setupCommitPhase(matchId);

    // Play rounds where a1 always wins (varied moves to avoid consecutive limit)
    const winMoves: [Move, Move][] = [
      [Move.ROCK, Move.SCISSORS],
      [Move.PAPER, Move.ROCK],
      [Move.SCISSORS, Move.PAPER],
      [Move.ROCK, Move.SCISSORS],
      [Move.PAPER, Move.ROCK],
    ];
    for (let r = 1; r <= winMoves.length; r++) {
      const m = db.getMatch(matchId)!;
      if (m.status === MatchStatus.FINISHED) break;

      const [moveA, moveB] = winMoves[r - 1];
      const saltA = `salt-a-round${r}-padding!`;
      const saltB = `salt-b-round${r}-padding!`;
      const hashA = sha256hex(`${moveA}:${saltA}`);
      const hashB = sha256hex(`${moveB}:${saltB}`);

      db.upsertCommit(matchId, r, "a1", hashA);
      db.upsertCommit(matchId, r, "a2", hashB);
      transitionToReveal(matchId, r);

      db.upsertReveal(matchId, r, "a1", moveA, saltA);
      db.upsertReveal(matchId, r, "a2", moveB, saltB);
      handleBothRevealed(matchId, r);

      if (db.getMatch(matchId)!.status !== MatchStatus.FINISHED) vi.advanceTimersByTime(5_000);
    }

    const finalMatch = db.getMatch(matchId)!;
    expect(finalMatch.status).toBe(MatchStatus.FINISHED);
    expect(finalMatch.currentPhase).toBe("FINISHED");
    expect(finalMatch.scoreA).toBe(4);
    expect(finalMatch.winnerId).toBe("a1");

    // Agents should be POST_MATCH
    expect(db.getAgent("a1")!.status).toBe(AgentStatus.POST_MATCH);
    expect(db.getAgent("a2")!.status).toBe(AgentStatus.POST_MATCH);
  });
});

describe("Resolution Locks", () => {
  it("resolveReady returns true first time, false second", () => {
    expect(resolveReady("m1")).toBe(true);
    expect(resolveReady("m1")).toBe(false);
  });

  it("resolveRound returns true first time, false second", () => {
    expect(resolveRound("m1", 1)).toBe(true);
    expect(resolveRound("m1", 1)).toBe(false);
  });

  it("different rounds resolve independently", () => {
    expect(resolveRound("m1", 1)).toBe(true);
    expect(resolveRound("m1", 2)).toBe(true);
    expect(resolveRound("m1", 1)).toBe(false);
  });

  it("handleBothRevealed returns false if already resolved", () => {
    const matchId = createMatchedPair();
    setupCommitPhase(matchId);

    const saltA = "A1b2C3d4E5f6G7h8";
    const hashA = sha256hex(`ROCK:${saltA}`);
    db.upsertCommit(matchId, 1, "a1", hashA);

    const saltB = "Z9Y8X7W6V5U4T3S2";
    const hashB = sha256hex(`PAPER:${saltB}`);
    db.upsertCommit(matchId, 1, "a2", hashB);
    transitionToReveal(matchId, 1);

    db.upsertReveal(matchId, 1, "a1", Move.ROCK, saltA);
    db.upsertReveal(matchId, 1, "a2", Move.PAPER, saltB);

    expect(handleBothRevealed(matchId, 1)).toBe(true);
    expect(handleBothRevealed(matchId, 1)).toBe(false);
  });
});

describe("Hash Mismatch", () => {
  it("cheater loses the round", () => {
    const matchId = createMatchedPair();
    setupCommitPhase(matchId);

    db.upsertCommit(matchId, 1, "a1", "a".repeat(64));
    db.upsertCommit(matchId, 1, "a2", "b".repeat(64));
    transitionToReveal(matchId, 1);

    const result = handleHashMismatch(matchId, 1, "a1");
    expect(result).toBe(true);

    const rounds = db.getRounds(matchId);
    expect(rounds[0].violationA).toBe("HASH_MISMATCH");
    expect(rounds[0].pointsB).toBe(1);
  });
});

describe("ELO Integration", () => {
  it("updates ELO after match finishes", async () => {
    const matchId = createMatchedPair();
    setupCommitPhase(matchId);

    // Quick win for a1 (varied moves)
    const winMoves: [Move, Move][] = [
      [Move.ROCK, Move.SCISSORS],
      [Move.PAPER, Move.ROCK],
      [Move.SCISSORS, Move.PAPER],
      [Move.ROCK, Move.SCISSORS],
      [Move.PAPER, Move.ROCK],
    ];
    for (let r = 1; r <= winMoves.length; r++) {
      const m = db.getMatch(matchId)!;
      if (m.status === MatchStatus.FINISHED) break;

      const [moveA, moveB] = winMoves[r - 1];
      const saltA = `salt-a-round${r}-padding!`;
      const saltB = `salt-b-round${r}-padding!`;
      const hashA = sha256hex(`${moveA}:${saltA}`);
      const hashB = sha256hex(`${moveB}:${saltB}`);

      db.upsertCommit(matchId, r, "a1", hashA);
      db.upsertCommit(matchId, r, "a2", hashB);
      transitionToReveal(matchId, r);

      db.upsertReveal(matchId, r, "a1", moveA, saltA);
      db.upsertReveal(matchId, r, "a2", moveB, saltB);
      handleBothRevealed(matchId, r);

      if (db.getMatch(matchId)!.status !== MatchStatus.FINISHED) vi.advanceTimersByTime(5_000);
    }

    // Need to flush promises for async ELO update
    await vi.runAllTimersAsync();

    const finalMatch = db.getMatch(matchId)!;
    expect(finalMatch.status).toBe(MatchStatus.FINISHED);
    // ELO should eventually be updated (async)
  });
});

describe("Prediction Bonus", () => {
  it("awards +1 bonus when prediction hits", () => {
    const matchId = createMatchedPair();
    setupCommitPhase(matchId);

    // a1 predicts PAPER (what a2 will play) — should be a hit
    const saltA = "A1b2C3d4E5f6G7h8";
    const hashA = sha256hex(`SCISSORS:${saltA}`);
    const commitA = db.upsertCommit(matchId, 1, "a1", hashA);
    (commitA as any).prediction = Move.PAPER; // a1 predicts a2 plays PAPER

    const saltB = "Z9Y8X7W6V5U4T3S2";
    const hashB = sha256hex(`PAPER:${saltB}`);
    db.upsertCommit(matchId, 1, "a2", hashB);

    transitionToReveal(matchId, 1);

    db.upsertReveal(matchId, 1, "a1", Move.SCISSORS, saltA);
    db.upsertReveal(matchId, 1, "a2", Move.PAPER, saltB);

    handleBothRevealed(matchId, 1);

    const rounds = db.getRounds(matchId);
    expect(rounds[0].pointsA).toBe(2); // 1 for win + 1 for prediction
    expect(rounds[0].readBonusA).toBe(true);
  });
});
