// NOTE: These tests intentionally import route handlers directly as lightweight integration tests.
// This is acceptable for MVP; full end-to-end coverage should replace this pattern over time.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/server/in-memory-db";
import { MatchStatus, Move, RoundPhase, RoundOutcome, AgentStatus, DEFAULT_AGENT_SETTINGS, type Match, type Round } from "@/types";
import { extractHighlights } from "@/lib/share/highlight-extractor";
import { generateShareToken } from "@/lib/share/share-card";
import { generateCommit } from "@/lib/fairness/commit-reveal";
import { hashApiKey } from "@/lib/server/auth";
import { resetRateLimiter } from "@/lib/server/rate-limiter";
import { POST as commitPOST } from "@/app/api/matches/[id]/rounds/[no]/commit/route";
import { POST as revealPOST } from "@/app/api/matches/[id]/rounds/[no]/reveal/route";
import { GET as voteGET, POST as votePOST } from "@/app/api/matches/[id]/votes/route";
import { NextRequest } from "next/server";

const KEY_A = "ak_live_share_test_a_key_123456";
const KEY_B = "ak_live_share_test_b_key_789012";

function createTestAgents() {
  const now = new Date();
  const base = {
    status: AgentStatus.IN_MATCH,
    elo: 1500,
    createdAt: now,
    updatedAt: now,
    queueCooldownUntil: null,
    queueBanUntil: null,
    consecutiveTimeouts: 0,
    suspiciousFlag: false,
    settings: { ...DEFAULT_AGENT_SETTINGS },
    consecutiveMatches: 0,
    consecutiveQualFails: 0,
    qualifiedAt: null,
    lastQualFailAt: null,
  };
  db.createAgent({ ...base, id: "agent-a", name: "Agent A", keyHash: hashApiKey(KEY_A) });
  db.createAgent({ ...base, id: "agent-b", name: "Agent B", keyHash: hashApiKey(KEY_B) });
}

beforeEach(() => {
  db.reset();
  resetRateLimiter();
  createTestAgents();
});

function fixtureMatch(): Match {
  return {
    id: "m-highlight",
    seasonId: "s1",
    agentA: "a1",
    agentB: "b1",
    status: MatchStatus.FINISHED,
    format: "BO7",
    scoreA: 4,
    scoreB: 3,
    winsA: 3,
    winsB: 3,
    currentRound: 7,
    maxRounds: 12,
    winnerId: "a1",
    startedAt: new Date(),
    finishedAt: new Date(),
    createdAt: new Date(),
    readyA: false,
    readyB: false,
    readyDeadline: null,
    currentPhase: "FINISHED" as Match["currentPhase"],
    phaseDeadline: null,
    eloChangeA: null,
    eloChangeB: null,
    eloUpdatedAt: null,
  };
}

function baseRound(roundNo: number): Round {
  return {
    id: `m-highlight:${roundNo}`,
    matchId: "m-highlight",
    roundNo,
    phase: RoundPhase.JUDGED,
    moveA: Move.ROCK,
    moveB: Move.SCISSORS,
    outcome: RoundOutcome.WIN_A,
    pointsA: 1,
    pointsB: 0,
    predictionBonusA: false,
    predictionBonusB: false,
    violationA: null,
    violationB: null,
    judgedAt: new Date(),
    createdAt: new Date(),
  };
}

describe("share/highlight extraction", () => {
  it("detects reversal and read-bonus highlights", () => {
    const rounds: Round[] = [
      { ...baseRound(1), pointsA: 0, pointsB: 1, outcome: RoundOutcome.WIN_B, moveA: Move.ROCK, moveB: Move.PAPER },
      { ...baseRound(2), pointsA: 0, pointsB: 1, outcome: RoundOutcome.WIN_B, moveA: Move.SCISSORS, moveB: Move.ROCK },
      { ...baseRound(3), pointsA: 2, pointsB: 0, predictionBonusA: true, outcome: RoundOutcome.WIN_A },
      { ...baseRound(4), pointsA: 2, pointsB: 0, predictionBonusA: true, outcome: RoundOutcome.WIN_A },
    ];

    const highlights = extractHighlights(fixtureMatch(), rounds);
    expect(highlights.some((h) => h.type === "REVERSAL")).toBe(true);
    expect(highlights.some((h) => h.type === "READ_BONUS")).toBe(true);
  });

  it("generates unique share tokens", () => {
    const tokens = new Set(Array.from({ length: 150 }, () => generateShareToken()));
    expect(tokens.size).toBe(150);
  });
});

describe("api request/response validation", () => {
  it("rejects invalid commit hash and accepts valid commit+reveal flow", async () => {
    const matchId = "match-1";
    // Update match to COMMIT phase for round 1
    const match = db.getMatch(matchId)!;
    db.updateMatch({ ...match, currentPhase: "COMMIT", currentRound: 1, phaseDeadline: new Date(Date.now() + 30000) });

    const badRequest = new NextRequest(`http://localhost/api/matches/${matchId}/rounds/1/commit`, {
      method: "POST",
      body: JSON.stringify({ hash: "bad" }),
      headers: { "content-type": "application/json", "x-agent-key": KEY_A },
    });

    const badRes = await commitPOST(badRequest, { params: Promise.resolve({ id: matchId, no: "1" }) });
    expect(badRes.status).toBe(400);

    const { createHash } = await import("node:crypto");
    const sha256 = (s: string) => createHash("sha256").update(s, "utf-8").digest("hex");

    const saltA = "A1b2C3d4E5f6G7h8";
    const moveA = Move.ROCK;
    const hashA = sha256(`${moveA}:${saltA}`);

    const commitResA = await commitPOST(
      new NextRequest(`http://localhost/api/matches/${matchId}/rounds/1/commit`, {
        method: "POST",
        body: JSON.stringify({ hash: hashA }),
        headers: { "content-type": "application/json", "x-agent-key": KEY_A },
      }),
      { params: Promise.resolve({ id: matchId, no: "1" }) },
    );
    expect(commitResA.status).toBe(200);

    const saltB = "Z9Y8X7W6V5U4T3S2";
    const moveB = Move.SCISSORS;
    const hashB = sha256(`${moveB}:${saltB}`);
    const commitResB = await commitPOST(
      new NextRequest(`http://localhost/api/matches/${matchId}/rounds/1/commit`, {
        method: "POST",
        body: JSON.stringify({ hash: hashB }),
        headers: { "content-type": "application/json", "x-agent-key": KEY_B },
      }),
      { params: Promise.resolve({ id: matchId, no: "1" }) },
    );
    expect(commitResB.status).toBe(200);

    const revealResA = await revealPOST(
      new NextRequest(`http://localhost/api/matches/${matchId}/rounds/1/reveal`, {
        method: "POST",
        body: JSON.stringify({ move: moveA, salt: saltA }),
        headers: { "content-type": "application/json", "x-agent-key": KEY_A },
      }),
      { params: Promise.resolve({ id: matchId, no: "1" }) },
    );
    expect(revealResA.status).toBe(200);

    const revealResB = await revealPOST(
      new NextRequest(`http://localhost/api/matches/${matchId}/rounds/1/reveal`, {
        method: "POST",
        body: JSON.stringify({ move: moveB, salt: saltB }),
        headers: { "content-type": "application/json", "x-agent-key": KEY_B },
      }),
      { params: Promise.resolve({ id: matchId, no: "1" }) },
    );
    expect(revealResB.status).toBe(200);
  });

  it("casts vote and returns tally", async () => {
    const matchId = "match-1";

    const postRes = await votePOST(
      new NextRequest(`http://localhost/api/matches/${matchId}/votes`, {
        method: "POST",
        body: JSON.stringify({ viewerId: "viewer-x", side: "A" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: matchId }) },
    );

    expect(postRes.status).toBe(201);

    const getRes = await voteGET(new NextRequest(`http://localhost/api/matches/${matchId}/votes`), {
      params: Promise.resolve({ id: matchId }),
    });
    expect(getRes.status).toBe(200);

    const payload = (await getRes.json()) as { tally: { a: number; b: number } };
    expect(payload.tally.a).toBe(1);
    expect(payload.tally.b).toBe(0);
  });
});
