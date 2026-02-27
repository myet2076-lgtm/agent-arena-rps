import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { checkMatchWinner, checkRoundTimeouts, createMatch, processRound } from "@/lib/engine";
import {
  buildRevealNonce,
  generateCommit,
  generateSalt,
  verifyAndRegisterNonce,
  verifyCommit,
} from "@/lib/fairness";
import { handleTimeout } from "@/lib/fairness";
import { db } from "@/lib/server/in-memory-db";
import { Match, MatchStatus, Move, RoundOutcome, RULES } from "@/types";

beforeEach(() => {
  db.reset();
});

describe("game engine", () => {
  it("runs a normal Bo7-style flow and finishes on points threshold", () => {
    let match = createMatch("agent-A", "agent-B", "season-1");
    const rounds = [] as ReturnType<typeof processRound>["round"][];

    const scriptedMoves: Array<[Move, Move]> = [
      [Move.ROCK, Move.SCISSORS],
      [Move.PAPER, Move.ROCK],
      [Move.SCISSORS, Move.PAPER],
      [Move.ROCK, Move.SCISSORS],
    ];

    for (const [a, b] of scriptedMoves) {
      const result = processRound(match, rounds, a, b);
      rounds.push(result.round);
      match = result.updatedMatch;
    }

    expect(match.status).toBe(MatchStatus.FINISHED);
    expect(match.scoreA).toBe(4);
    expect(match.scoreB).toBe(0);
    expect(match.winnerId).toBe("agent-A");
    expect(match.currentRound).toBe(4);
  });

  it("applies read-bonus scoring (+2 points) when winner beats opponent previous move", () => {
    let match = createMatch("agent-A", "agent-B", "season-1");
    const rounds = [] as ReturnType<typeof processRound>["round"][];

    const first = processRound(match, rounds, Move.ROCK, Move.PAPER);
    rounds.push(first.round);
    match = first.updatedMatch;

    const second = processRound(match, rounds, Move.SCISSORS, Move.PAPER);

    expect(second.round.outcome).toBe(RoundOutcome.WIN_A);
    expect(second.round.readBonusA).toBe(true);
    expect(second.round.pointsA).toBe(2);
    expect(second.updatedMatch.scoreA).toBe(2);
  });

  it("enforces move use limit violation", () => {
    let match = createMatch("agent-A", "agent-B", "season-1");
    const rounds = [] as ReturnType<typeof processRound>["round"][];

    // A uses ROCK exactly 4 times (allowed), 5th is a violation.
    const firstFour: Array<[Move, Move]> = [
      [Move.ROCK, Move.PAPER],
      [Move.ROCK, Move.PAPER],
      [Move.ROCK, Move.PAPER],
      [Move.ROCK, Move.PAPER],
    ];

    for (const [a, b] of firstFour) {
      const result = processRound(match, rounds, a, b);
      rounds.push(result.round);
      match = result.updatedMatch;
      if (match.status === MatchStatus.FINISHED) {
        match = { ...match, status: MatchStatus.RUNNING, winnerId: null, finishedAt: null };
      }
    }

    const fifth = processRound(match, rounds, Move.ROCK, Move.SCISSORS);

    expect(fifth.round.violationA).toBe("MOVE_USE_LIMIT");
    expect(fifth.round.outcome).toBe(RoundOutcome.FORFEIT_A);
    expect(fifth.round.pointsB).toBe(1);
  });

  it("enforces consecutive move violation (3rd same in a row)", () => {
    let match = createMatch("agent-A", "agent-B", "season-1");
    const rounds = [] as ReturnType<typeof processRound>["round"][];

    const one = processRound(match, rounds, Move.PAPER, Move.ROCK);
    rounds.push(one.round);
    match = one.updatedMatch;

    const two = processRound(match, rounds, Move.PAPER, Move.ROCK);
    rounds.push(two.round);
    match = two.updatedMatch;

    const three = processRound(match, rounds, Move.PAPER, Move.SCISSORS);

    expect(three.round.violationA).toBe("CONSECUTIVE_LIMIT");
    expect(three.round.outcome).toBe(RoundOutcome.FORFEIT_A);
  });

  it("handles timeout forfeit", () => {
    const timeout = handleTimeout("match-timeout", 3, "A", 2, 1);

    expect(timeout.round.outcome).toBe(RoundOutcome.FORFEIT_A);
    expect(timeout.round.violationA).toBe("TIMEOUT");
    expect(timeout.events[0].type).toBe("ROUND_RESULT");
    expect(timeout.events[0]).toMatchObject({ scoreA: 2, scoreB: 2 });
  });

  it("handles both agents timing out in the same round", () => {
    const timeout = handleTimeout("match-timeout", 4, "BOTH", 3, 3);

    expect(timeout.round.outcome).toBe(RoundOutcome.DRAW);
    expect(timeout.round.pointsA).toBe(0);
    expect(timeout.round.pointsB).toBe(0);
    expect(timeout.round.violationA).toBe("TIMEOUT");
    expect(timeout.round.violationB).toBe("TIMEOUT");
    expect(timeout.events[0]).toMatchObject({ scoreA: 3, scoreB: 3 });
  });

  it("resolves both reaching threshold simultaneously by points then wins", () => {
    const synthetic: Match = {
      id: "m-threshold",
      seasonId: "s1",
      agentA: "agent-A",
      agentB: "agent-B",
      status: MatchStatus.RUNNING,
      format: "BO7",
      scoreA: 4,
      scoreB: 4,
      winsA: 3,
      winsB: 2,
      currentRound: 8,
      maxRounds: RULES.MAX_ROUNDS,
      winnerId: null,
      startedAt: new Date(),
      finishedAt: null,
      createdAt: new Date(), readyA: false, readyB: false, readyDeadline: null, currentPhase: "COMMIT" as Match["currentPhase"], phaseDeadline: null, eloChangeA: null, eloChangeB: null, eloUpdatedAt: null,
    };

    expect(checkMatchWinner(synthetic)).toBe("agent-A");
  });

  it("resolves max rounds by points tiebreaker first", () => {
    const synthetic: Match = {
      id: "m1",
      seasonId: "s1",
      agentA: "agent-A",
      agentB: "agent-B",
      status: MatchStatus.RUNNING,
      format: "BO7",
      scoreA: 5,
      scoreB: 4,
      winsA: 3,
      winsB: 5,
      currentRound: RULES.MAX_ROUNDS,
      maxRounds: RULES.MAX_ROUNDS,
      winnerId: null,
      startedAt: new Date(),
      finishedAt: null,
      createdAt: new Date(), readyA: false, readyB: false, readyDeadline: null, currentPhase: "COMMIT" as Match["currentPhase"], phaseDeadline: null, eloChangeA: null, eloChangeB: null, eloUpdatedAt: null,
    };

    expect(checkMatchWinner(synthetic)).toBe("agent-A");
  });

  it("resolves max rounds by round wins when points are tied", () => {
    const synthetic: Match = {
      id: "m2",
      seasonId: "s1",
      agentA: "agent-A",
      agentB: "agent-B",
      status: MatchStatus.RUNNING,
      format: "BO7",
      scoreA: 4,
      scoreB: 4,
      winsA: 5,
      winsB: 4,
      currentRound: RULES.MAX_ROUNDS,
      maxRounds: RULES.MAX_ROUNDS,
      winnerId: null,
      startedAt: new Date(),
      finishedAt: null,
      createdAt: new Date(), readyA: false, readyB: false, readyDeadline: null, currentPhase: "COMMIT" as Match["currentPhase"], phaseDeadline: null, eloChangeA: null, eloChangeB: null, eloUpdatedAt: null,
    };

    expect(checkMatchWinner(synthetic)).toBe("agent-A");
  });

  it("returns draw when max rounds reached and both points/wins are tied", () => {
    const synthetic: Match = {
      id: "m3",
      seasonId: "s1",
      agentA: "agent-A",
      agentB: "agent-B",
      status: MatchStatus.RUNNING,
      format: "BO7",
      scoreA: 4,
      scoreB: 4,
      winsA: 4,
      winsB: 4,
      currentRound: RULES.MAX_ROUNDS,
      maxRounds: RULES.MAX_ROUNDS,
      winnerId: null,
      startedAt: new Date(),
      finishedAt: null,
      createdAt: new Date(), readyA: false, readyB: false, readyDeadline: null, currentPhase: "COMMIT" as Match["currentPhase"], phaseDeadline: null, eloChangeA: null, eloChangeB: null, eloUpdatedAt: null,
    };

    expect(checkMatchWinner(synthetic)).toBe("DRAW");
  });
});

describe("commit-reveal fairness", () => {
  it("verifies commit hash correctly", () => {
    const salt = generateSalt();
    const roundId = "round-1";
    const agentId = "agent-A";
    const move = Move.ROCK;

    const commit = generateCommit(move, salt, roundId, agentId);

    expect(verifyCommit(commit, move, salt, roundId, agentId)).toBe(true);
    expect(verifyCommit(commit, Move.PAPER, salt, roundId, agentId)).toBe(false);
  });

  it("blocks nonce replay", () => {
    const usedNonces = new Set<string>();
    const nonce = buildRevealNonce("round-1", "agent-A", "salt-123");

    expect(verifyAndRegisterNonce(nonce, usedNonces)).toBe(true);
    expect(verifyAndRegisterNonce(nonce, usedNonces)).toBe(false);
  });
});

describe("timeout enforcement", () => {
  it("returns commit-timeout forfeit for missing second commit", () => {
    const matchId = `match-timeout-commit-${randomUUID()}`;
    const match = createMatch("agent-A", "agent-B", "season-1");
    db.updateMatch({ ...match, id: matchId });

    const commitA = db.upsertCommit(matchId, 1, "agent-A", "a".repeat(64));
    commitA.expiresAt = new Date(Date.now() - 1);

    const check = checkRoundTimeouts(matchId, 1, { ...match, id: matchId });
    expect(check).toEqual({ timedOut: true, forfeitAgentId: "agent-B" });
  });

  it("returns reveal-timeout forfeit when one reveal is late", () => {
    const matchId = `match-timeout-reveal-${randomUUID()}`;
    const match = createMatch("agent-A", "agent-B", "season-1");
    db.updateMatch({ ...match, id: matchId });

    const commitA = db.upsertCommit(matchId, 1, "agent-A", "b".repeat(64));
    const commitB = db.upsertCommit(matchId, 1, "agent-B", "c".repeat(64));

    const stale = new Date(Date.now() - RULES.REVEAL_TIMEOUT_MS - 50);
    commitA.committedAt = stale;
    commitB.committedAt = stale;

    db.upsertReveal(matchId, 1, "agent-A", Move.ROCK, "salt-a");

    const check = checkRoundTimeouts(matchId, 1, { ...match, id: matchId });
    expect(check).toEqual({ timedOut: true, forfeitAgentId: "agent-B" });
  });

  it("does not timeout when both commits exist and no reveal is late yet", () => {
    const matchId = `match-timeout-none-${randomUUID()}`;
    const match = createMatch("agent-A", "agent-B", "season-1");
    db.updateMatch({ ...match, id: matchId });

    db.upsertCommit(matchId, 1, "agent-A", "d".repeat(64));
    db.upsertCommit(matchId, 1, "agent-B", "e".repeat(64));

    const check = checkRoundTimeouts(matchId, 1, { ...match, id: matchId });
    expect(check).toEqual({ timedOut: false, forfeitAgentId: null });
  });
});
