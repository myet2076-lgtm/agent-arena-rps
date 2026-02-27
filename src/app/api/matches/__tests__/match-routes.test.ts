/**
 * Sprint 3 API Route Tests — Ready, Commit, Reveal, SSE
 */

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/server/in-memory-db";
import { resetScheduler, startReadyCheck } from "@/lib/services/match-scheduler";
import { resetRateLimiter } from "@/lib/server/rate-limiter";
import { hashApiKey } from "@/lib/server/auth";
import {
  AgentStatus,
  type AgentRecord,
  type Match,
  MatchStatus,
  DEFAULT_AGENT_SETTINGS,
  RULES,
  RoundPhase,
  RoundOutcome,
  Move,
} from "@/types";
import { POST as readyPOST } from "@/app/api/matches/[id]/ready/route";
import { POST as commitPOST } from "@/app/api/matches/[id]/rounds/[no]/commit/route";
import { POST as revealPOST } from "@/app/api/matches/[id]/rounds/[no]/reveal/route";
import { GET as sseGET } from "@/app/api/matches/[id]/events/route";
import { GET as matchDetailGET } from "@/app/api/matches/[id]/route";
import { createHash } from "node:crypto";

const KEY_A = "ak_live_test_agent_a_key_1234";
const KEY_B = "ak_live_test_agent_b_key_5678";
const KEY_C = "ak_live_test_agent_c_key_9999";

function makeAgent(id: string, keyHash: string, status: AgentStatus = AgentStatus.IN_MATCH): AgentRecord {
  const now = new Date();
  return {
    id, name: id, keyHash, status, elo: 1500,
    createdAt: now, updatedAt: now,
    queueCooldownUntil: null, queueBanUntil: null,
    consecutiveTimeouts: 0, suspiciousFlag: false,
    settings: { ...DEFAULT_AGENT_SETTINGS },
    consecutiveMatches: 0, consecutiveQualFails: 0, qualifiedAt: null, lastQualFailAt: null,
  };
}

function makeMatch(id: string, agentA: string, agentB: string, phase: Match["currentPhase"] = "READY_CHECK"): Match {
  const now = new Date();
  return {
    id, seasonId: "s1", agentA, agentB,
    status: MatchStatus.RUNNING, format: "BO7",
    scoreA: 0, scoreB: 0, winsA: 0, winsB: 0,
    currentRound: phase === "READY_CHECK" ? 0 : 1,
    maxRounds: RULES.MAX_ROUNDS,
    winnerId: null, startedAt: now, finishedAt: null, createdAt: now,
    readyA: false, readyB: false,
    readyDeadline: new Date(Date.now() + 30000),
    currentPhase: phase,
    phaseDeadline: new Date(Date.now() + 30000),
    eloChangeA: null, eloChangeB: null, eloUpdatedAt: null,
  };
}

function req(url: string, key?: string, body?: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers["x-agent-key"] = key;
  return new Request(url, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

beforeEach(() => {
  db.reset();
  resetScheduler();
  resetRateLimiter();
  db.createAgent(makeAgent("a1", hashApiKey(KEY_A)));
  db.createAgent(makeAgent("a2", hashApiKey(KEY_B)));
  db.createAgent(makeAgent("a3", hashApiKey(KEY_C), AgentStatus.QUALIFIED));
});

// ─── Ready Endpoint ──────────────────────────────────────

describe("Ready endpoint", () => {
  it("happy path: both agents ready → transitions to COMMIT", async () => {
    const match = makeMatch("m1", "a1", "a2");
    db.updateMatch(match);
    startReadyCheck("m1");

    const r1 = await readyPOST(req("http://x/api/matches/m1/ready", KEY_A));
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.status).toBe("READY");

    const r2 = await readyPOST(req("http://x/api/matches/m1/ready", KEY_B));
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.status).toBe("STARTING");

    const updated = db.getMatch("m1")!;
    expect(updated.currentPhase).toBe("COMMIT");
  });

  it("idempotent: duplicate ready → 200", async () => {
    const match = makeMatch("m1", "a1", "a2");
    db.updateMatch(match);
    startReadyCheck("m1");

    await readyPOST(req("http://x/api/matches/m1/ready", KEY_A));
    const r2 = await readyPOST(req("http://x/api/matches/m1/ready", KEY_A));
    expect(r2.status).toBe(200);
  });

  it("no key → 401", async () => {
    db.updateMatch(makeMatch("m1", "a1", "a2"));
    startReadyCheck("m1");
    const r = await readyPOST(req("http://x/api/matches/m1/ready"));
    expect(r.status).toBe(401);
    const b = await r.json();
    expect(b.error).toBe("MISSING_KEY");
  });

  it("wrong agent → 403", async () => {
    db.updateMatch(makeMatch("m1", "a1", "a2"));
    startReadyCheck("m1");
    const r = await readyPOST(req("http://x/api/matches/m1/ready", KEY_C));
    expect(r.status).toBe(403);
    const b = await r.json();
    expect(b.error).toBe("NOT_YOUR_MATCH");
  });

  it("wrong phase → 409 MATCH_NOT_IN_READY_CHECK", async () => {
    const match = makeMatch("m1", "a1", "a2", "COMMIT");
    db.updateMatch(match);
    const r = await readyPOST(req("http://x/api/matches/m1/ready", KEY_A));
    expect(r.status).toBe(409);
    const b = await r.json();
    expect(b.error).toBe("MATCH_NOT_IN_READY_CHECK");
  });
});

// ─── Commit Endpoint ─────────────────────────────────────

describe("Commit endpoint", () => {
  function setupCommitPhase() {
    const match = makeMatch("m1", "a1", "a2", "COMMIT");
    match.currentRound = 1;
    db.updateMatch(match);
  }

  it("happy path: valid hash → 200 COMMITTED", async () => {
    setupCommitPhase();
    const hash = sha256("ROCK:mysalt1234567890");
    const r = await commitPOST(req("http://x/api/matches/m1/rounds/1/commit", KEY_A, { hash }));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.status).toBe("COMMITTED");
  });

  it("invalid hash format → 400 INVALID_HASH_FORMAT", async () => {
    setupCommitPhase();
    const r = await commitPOST(req("http://x/api/matches/m1/rounds/1/commit", KEY_A, { hash: "not-a-hex" }));
    expect(r.status).toBe(400);
    const b = await r.json();
    expect(b.error).toBe("INVALID_HASH_FORMAT");
  });

  it("idempotent: duplicate commit → 200", async () => {
    setupCommitPhase();
    const hash = sha256("ROCK:mysalt1234567890");
    await commitPOST(req("http://x/api/matches/m1/rounds/1/commit", KEY_A, { hash }));
    const r2 = await commitPOST(req("http://x/api/matches/m1/rounds/1/commit", KEY_A, { hash }));
    expect(r2.status).toBe(200);
    const b = await r2.json();
    expect(b.status).toBe("COMMITTED");
  });

  it("wrong round → 400 ROUND_NOT_ACTIVE", async () => {
    setupCommitPhase();
    const hash = sha256("ROCK:mysalt1234567890");
    const r = await commitPOST(req("http://x/api/matches/m1/rounds/5/commit", KEY_A, { hash }));
    expect(r.status).toBe(400);
    const b = await r.json();
    expect(b.error).toBe("ROUND_NOT_ACTIVE");
  });
});

// ─── Reveal Endpoint ─────────────────────────────────────

describe("Reveal endpoint", () => {
  const SALT = "abcdefghij1234567890";
  const MOVE = "ROCK";

  function setupRevealPhase() {
    const match = makeMatch("m1", "a1", "a2", "REVEAL");
    match.currentRound = 1;
    db.updateMatch(match);
    // Create commits
    const hashA = sha256(`${MOVE}:${SALT}`);
    const hashB = sha256(`PAPER:${SALT}`);
    db.upsertCommit("m1", 1, "a1", hashA);
    db.upsertCommit("m1", 1, "a2", hashB);
  }

  it("happy path: valid move+salt → 200 REVEALED", async () => {
    setupRevealPhase();
    const r = await revealPOST(req("http://x/api/matches/m1/rounds/1/reveal", KEY_A, { move: MOVE, salt: SALT }));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.status).toBe("REVEALED");

    // Verify the reveal is marked as verified
    const reveal = db.getReveal("m1", 1, "a1");
    expect(reveal?.verified).toBe(true);
  });

  it("hash mismatch → 422 HASH_MISMATCH", async () => {
    setupRevealPhase();
    const r = await revealPOST(req("http://x/api/matches/m1/rounds/1/reveal", KEY_A, { move: "PAPER", salt: SALT }));
    expect(r.status).toBe(422);
    const b = await r.json();
    expect(b.error).toBe("HASH_MISMATCH");
  });

  it("invalid salt (too short) → 400 INVALID_SALT", async () => {
    setupRevealPhase();
    const r = await revealPOST(req("http://x/api/matches/m1/rounds/1/reveal", KEY_A, { move: MOVE, salt: "short" }));
    expect(r.status).toBe(400);
    const b = await r.json();
    expect(b.error).toBe("INVALID_SALT");
  });

  it("invalid salt (whitespace) → 400 INVALID_SALT", async () => {
    setupRevealPhase();
    const r = await revealPOST(req("http://x/api/matches/m1/rounds/1/reveal", KEY_A, { move: MOVE, salt: "has space in salt!!" }));
    expect(r.status).toBe(400);
    const b = await r.json();
    expect(b.error).toBe("INVALID_SALT");
  });

  it("lowercase move → 400 INVALID_MOVE", async () => {
    setupRevealPhase();
    const r = await revealPOST(req("http://x/api/matches/m1/rounds/1/reveal", KEY_A, { move: "rock", salt: SALT }));
    expect(r.status).toBe(400);
    const b = await r.json();
    expect(b.error).toBe("INVALID_MOVE");
  });

  it("idempotent: duplicate reveal → 200", async () => {
    setupRevealPhase();
    await revealPOST(req("http://x/api/matches/m1/rounds/1/reveal", KEY_A, { move: MOVE, salt: SALT }));
    const r2 = await revealPOST(req("http://x/api/matches/m1/rounds/1/reveal", KEY_A, { move: MOVE, salt: SALT }));
    expect(r2.status).toBe(200);
    const b = await r2.json();
    expect(b.status).toBe("REVEALED");
  });
});

// ─── SSE Perspective ─────────────────────────────────────

describe("SSE perspective", () => {
  function setupFinishedMatch() {
    const match = makeMatch("m1", "a1", "a2", "FINISHED");
    match.status = MatchStatus.FINISHED;
    db.updateMatch(match);
  }

  it("no key → viewer perspective (200)", async () => {
    setupFinishedMatch();
    const r = new Request("http://x/api/matches/m1/events", { method: "GET" });
    const res = await sseGET(r as any, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  it("participant key → 200 (agent perspective)", async () => {
    setupFinishedMatch();
    const r = new Request("http://x/api/matches/m1/events", {
      method: "GET",
      headers: { "x-agent-key": KEY_A },
    });
    const res = await sseGET(r as any, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);
  });

  it("non-participant key → 200 (viewer perspective)", async () => {
    setupFinishedMatch();
    const r = new Request("http://x/api/matches/m1/events", {
      method: "GET",
      headers: { "x-agent-key": KEY_C },
    });
    const res = await sseGET(r as any, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);
  });

  it("invalid key → 401", async () => {
    setupFinishedMatch();
    const r = new Request("http://x/api/matches/m1/events", {
      method: "GET",
      headers: { "x-agent-key": "invalid-key-12345" },
    });
    const res = await sseGET(r as any, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(401);
  });
});

// ─── Match Detail F12 ────────────────────────────────────

describe("Match detail endpoint (F12)", () => {
  it("FINISHED match returns enhanced response with rounds and eloChanges", async () => {
    const match = makeMatch("m1", "a1", "a2", "FINISHED");
    match.status = MatchStatus.FINISHED;
    match.scoreA = 2;
    match.scoreB = 1;
    match.winnerId = "a1";
    match.eloChangeA = 16;
    match.eloChangeB = -16;
    match.eloUpdatedAt = new Date();
    match.finishedAt = new Date();
    db.updateMatch(match);

    // Add rounds
    db.addRound({
      id: "r1", matchId: "m1", roundNo: 1, phase: RoundPhase.PUBLISHED,
      moveA: Move.ROCK, moveB: Move.SCISSORS, outcome: RoundOutcome.WIN_A,
      pointsA: 1, pointsB: 0, predictionBonusA: false, predictionBonusB: false,
      violationA: null, violationB: null, judgedAt: new Date(), createdAt: new Date(),
    });
    db.addRound({
      id: "r2", matchId: "m1", roundNo: 2, phase: RoundPhase.PUBLISHED,
      moveA: Move.PAPER, moveB: Move.SCISSORS, outcome: RoundOutcome.WIN_B,
      pointsA: 0, pointsB: 1, predictionBonusA: false, predictionBonusB: false,
      violationA: null, violationB: null, judgedAt: new Date(), createdAt: new Date(),
    });
    db.addRound({
      id: "r3", matchId: "m1", roundNo: 3, phase: RoundPhase.PUBLISHED,
      moveA: Move.ROCK, moveB: Move.SCISSORS, outcome: RoundOutcome.WIN_A,
      pointsA: 1, pointsB: 0, predictionBonusA: false, predictionBonusB: false,
      violationA: null, violationB: null, judgedAt: new Date(), createdAt: new Date(),
    });

    const r = new Request("http://x/api/matches/m1", { method: "GET" });
    const res = await matchDetailGET(r, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.match.status).toBe("FINISHED");
    expect(body.match.winnerId).toBe("a1");
    expect(body.match.scoreA).toBe(2);
    expect(body.match.scoreB).toBe(1);
    expect(body.rounds).toHaveLength(3);
    expect(body.rounds[0].moveA).toBe("ROCK");
    expect(body.rounds[0].winner).toBe("A");
    expect(body.eloChanges).toEqual({ a1: 16, a2: -16 });
    expect(body.eloUpdatedAt).toBeTruthy();
  });

  it("non-FINISHED match returns basic info without moves", async () => {
    const match = makeMatch("m1", "a1", "a2", "COMMIT");
    match.currentRound = 1;
    db.updateMatch(match);

    const r = new Request("http://x/api/matches/m1", { method: "GET" });
    const res = await matchDetailGET(r, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.match.status).toBe("RUNNING");
    expect(body.rounds).toEqual([]);
    expect(body.eloChanges).toBeUndefined();
    expect(body.match.id).toBe("m1");
  });
});
