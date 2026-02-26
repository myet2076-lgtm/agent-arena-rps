// NOTE: These tests intentionally import route handlers directly as lightweight integration tests.
// This is acceptable for MVP; full end-to-end coverage should replace this pattern over time.
import { describe, expect, it } from "vitest";
import { MatchStatus, Move, RoundPhase, RoundOutcome, type Match, type Round } from "@/types";
import { extractHighlights } from "@/lib/share/highlight-extractor";
import { generateShareToken } from "@/lib/share/share-card";
import { generateCommit } from "@/lib/fairness/commit-reveal";
import { POST as commitPOST } from "@/app/api/matches/[id]/rounds/[no]/commit/route";
import { POST as revealPOST } from "@/app/api/matches/[id]/rounds/[no]/reveal/route";
import { GET as voteGET, POST as votePOST } from "@/app/api/matches/[id]/votes/route";
import { NextRequest } from "next/server";

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
    readBonusA: false,
    readBonusB: false,
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
      { ...baseRound(3), pointsA: 2, pointsB: 0, readBonusA: true, outcome: RoundOutcome.WIN_A },
      { ...baseRound(4), pointsA: 2, pointsB: 0, readBonusA: true, outcome: RoundOutcome.WIN_A },
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
    const badRequest = new NextRequest(`http://localhost/api/matches/${matchId}/rounds/1/commit`, {
      method: "POST",
      body: JSON.stringify({ agentId: "agent-a", commitHash: "bad" }),
      headers: { "content-type": "application/json" },
    });

    const badRes = await commitPOST(badRequest, { params: Promise.resolve({ id: matchId, no: "1" }) });
    expect(badRes.status).toBe(422);

    const roundId = `${matchId}:1`;
    const saltA = "s-a";
    const moveA = Move.ROCK;
    const hashA = generateCommit(moveA, saltA, roundId, "agent-a");

    const commitResA = await commitPOST(
      new NextRequest(`http://localhost/api/matches/${matchId}/rounds/1/commit`, {
        method: "POST",
        body: JSON.stringify({ agentId: "agent-a", commitHash: hashA }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: matchId, no: "1" }) },
    );
    expect(commitResA.status).toBe(201);

    const saltB = "s-b";
    const moveB = Move.SCISSORS;
    const hashB = generateCommit(moveB, saltB, roundId, "agent-b");
    const commitResB = await commitPOST(
      new NextRequest(`http://localhost/api/matches/${matchId}/rounds/1/commit`, {
        method: "POST",
        body: JSON.stringify({ agentId: "agent-b", commitHash: hashB }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: matchId, no: "1" }) },
    );
    expect(commitResB.status).toBe(201);

    const revealResA = await revealPOST(
      new NextRequest(`http://localhost/api/matches/${matchId}/rounds/1/reveal`, {
        method: "POST",
        body: JSON.stringify({ agentId: "agent-a", move: moveA, salt: saltA }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: matchId, no: "1" }) },
    );
    expect(revealResA.status).toBe(200);

    const revealResB = await revealPOST(
      new NextRequest(`http://localhost/api/matches/${matchId}/rounds/1/reveal`, {
        method: "POST",
        body: JSON.stringify({ agentId: "agent-b", move: moveB, salt: saltB }),
        headers: { "content-type": "application/json" },
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
