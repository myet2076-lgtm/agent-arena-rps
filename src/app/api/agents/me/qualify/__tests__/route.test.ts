import { describe, it, expect, beforeEach } from "vitest";
import { POST as startQual } from "../route";
import { POST as submitRound } from "../[qualMatchId]/rounds/[roundNo]/route";
import { db } from "@/lib/server/in-memory-db";
import { AgentStatus, DEFAULT_AGENT_SETTINGS } from "@/types";
import { hashApiKey } from "@/lib/server/auth";
import { resetRateLimiter } from "@/lib/server/rate-limiter";
import { resetQualService } from "@/lib/services/qual-service";

const TEST_KEY = "ak_live_testkey1234567890abcdef";

function setupAgent(status: AgentStatus = AgentStatus.REGISTERED) {
  db.createAgent({
    id: "agent-testbot",
    name: "TestBot",
    keyHash: hashApiKey(TEST_KEY),
    status,
    elo: 1500,
    createdAt: new Date(),
    updatedAt: new Date(),
    queueCooldownUntil: null,
    queueBanUntil: null,
    consecutiveTimeouts: 0,
    suspiciousFlag: false,
    settings: { ...DEFAULT_AGENT_SETTINGS },
    consecutiveMatches: 0,
    consecutiveQualFails: 0,
  });
}

function makeReq(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-key": TEST_KEY },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("POST /api/agents/me/qualify", () => {
  beforeEach(() => {
    db.reset();
    resetRateLimiter();
    resetQualService();
  });

  it("starts qualification", async () => {
    setupAgent();
    const res = await startQual(makeReq("http://localhost/api/agents/me/qualify?difficulty=easy"));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.qualMatchId).toBeTruthy();
    expect(body.totalRounds).toBe(5);
  });

  it("rejects without auth", async () => {
    const res = await startQual(
      new Request("http://localhost/api/agents/me/qualify", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects non-registered agent", async () => {
    setupAgent(AgentStatus.QUALIFIED);
    const res = await startQual(makeReq("http://localhost/api/agents/me/qualify"));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/agents/me/qualify/{id}/rounds/{no}", () => {
  beforeEach(() => {
    db.reset();
    resetRateLimiter();
    resetQualService();
  });

  it("submits a round and gets result", async () => {
    setupAgent();
    const startRes = await startQual(makeReq("http://localhost/api/agents/me/qualify?difficulty=easy"));
    const { qualMatchId } = await startRes.json();

    const roundRes = await submitRound(
      makeReq(`http://localhost/api/agents/me/qualify/${qualMatchId}/rounds/1`, { move: "PAPER" }),
      { params: Promise.resolve({ qualMatchId, roundNo: "1" }) },
    );
    expect(roundRes.status).toBe(200);
    const body = await roundRes.json();
    expect(body.round).toBe(1);
    expect(["WIN", "LOSE", "DRAW"]).toContain(body.result);
  });

  it("rejects invalid move", async () => {
    setupAgent();
    const startRes = await startQual(makeReq("http://localhost/api/agents/me/qualify"));
    const { qualMatchId } = await startRes.json();

    const res = await submitRound(
      makeReq(`http://localhost/api/agents/me/qualify/${qualMatchId}/rounds/1`, { move: "INVALID" }),
      { params: Promise.resolve({ qualMatchId, roundNo: "1" }) },
    );
    expect(res.status).toBe(400);
  });
});
