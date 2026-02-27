import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "../route";
import { db } from "@/lib/server/in-memory-db";
import { resetRateLimiter } from "@/lib/server/rate-limiter";
import { resetRegistrationTracker } from "@/lib/server/registration-tracker";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agents", () => {
  beforeEach(() => {
    db.reset();
    resetRateLimiter();
    resetRegistrationTracker();
  });

  it("registers agent successfully", async () => {
    const res = await POST(makeReq({ name: "TestBot" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.agentId).toBe("agent-testbot");
    expect(body.name).toBe("TestBot");
    expect(body.apiKey).toMatch(/^ak_live_[a-f0-9]{32}$/);
    expect(body.status).toBe("REGISTERED");
    expect(body.elo).toBe(1500);
  });

  it("rejects missing name", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("rejects duplicate name", async () => {
    await POST(makeReq({ name: "TestBot" }));
    const res = await POST(makeReq({ name: "TestBot" }));
    expect(res.status).toBe(409);
  });

  it("rejects name too short", async () => {
    const res = await POST(makeReq({ name: "Ab" }));
    expect(res.status).toBe(400);
  });

  it("stores key hash, not raw key", async () => {
    await POST(makeReq({ name: "SecureBot" }));
    const agent = db.getAgent("agent-securebot");
    expect(agent).toBeTruthy();
    expect(agent!.keyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("respects per-email registration limit of 5", async () => {
    // Directly create 5 agents with same email
    const { AgentStatus, DEFAULT_AGENT_SETTINGS } = await import("@/types");
    for (let i = 0; i < 5; i++) {
      db.createAgent({
        id: `agent-bot${i}`,
        name: `Bot${i}`,
        keyHash: `hash${i}`,
        status: AgentStatus.REGISTERED,
        elo: 1500,
        authorEmail: "test@example.com",
        createdAt: new Date(),
        updatedAt: new Date(),
        queueCooldownUntil: null,
        queueBanUntil: null,
        consecutiveTimeouts: 0,
        suspiciousFlag: false,
        settings: { ...DEFAULT_AGENT_SETTINGS },
        consecutiveMatches: 0,
        consecutiveQualFails: 0,
        qualifiedAt: null,
        lastQualFailAt: null,
      });
    }
    const res = await POST(makeReq({ name: "OneMore", authorEmail: "test@example.com" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("REGISTRATION_LIMIT");
  });
});
