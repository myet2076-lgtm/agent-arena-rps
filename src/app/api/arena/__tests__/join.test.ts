import { describe, expect, it, beforeEach, vi } from "vitest";
import { POST } from "../join/route";
import { db } from "@/lib/server/in-memory-db";
import { AgentStatus } from "@/types";

function makeRequest(body: Record<string, unknown> | null, headers?: Record<string, string>): Request {
  const opts: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "test-ip-" + Math.random(),
      ...headers,
    },
  };
  if (body !== null) {
    opts.body = JSON.stringify(body);
  } else {
    opts.body = "not-json";
  }
  return new Request("http://localhost:3000/api/arena/join", opts);
}

describe("POST /api/arena/join", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --- Happy path ---

  it("registers, qualifies, and queues a new agent in one call", async () => {
    const name = `TestBot-${Date.now()}`;
    const res = await POST(makeRequest({ name }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.agentId).toContain("agent-");
    expect(data.name).toBe(name);
    expect(data.apiKey).toBeDefined();
    expect(data.status).toBe("QUEUED");
    expect(data.isNewAgent).toBe(true);
    expect(data.position).toBeGreaterThanOrEqual(1);
    expect(data.queueId).toBeDefined();
  });

  it("re-queues existing agent with valid api key", async () => {
    const name = `RequeueBot-${Date.now()}`;
    const ip = "test-requeue-" + Date.now();
    const createRes = await POST(makeRequest({ name }, { "x-forwarded-for": ip }));
    const createData = await createRes.json();

    const agent = db.getAgent(createData.agentId)!;
    db.updateAgent({ ...agent, status: AgentStatus.POST_MATCH, updatedAt: new Date() });

    const { leaveQueue } = await import("@/lib/services/queue-service");
    leaveQueue(createData.agentId);

    const res = await POST(makeRequest(
      { name },
      { "x-agent-key": createData.apiKey, "x-forwarded-for": ip },
    ));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.isNewAgent).toBe(false);
    expect(data.apiKey).toBeUndefined();
    expect(data.status).toBe("QUEUED");
  });

  // --- Name validation ---

  it("rejects invalid name (too short)", async () => {
    const res = await POST(makeRequest({ name: "ab" }));
    expect(res.status).toBe(400);
  });

  it("rejects name with trailing hyphen", async () => {
    const res = await POST(makeRequest({ name: "TestBot-" }));
    expect(res.status).toBe(400);
  });

  it("rejects name with consecutive hyphens", async () => {
    const res = await POST(makeRequest({ name: "Test--Bot" }));
    expect(res.status).toBe(400);
  });

  it("rejects name longer than 32 chars", async () => {
    const res = await POST(makeRequest({ name: "A".repeat(33) }));
    expect(res.status).toBe(400);
  });

  // --- Input validation ---

  it("rejects empty/missing body (invalid JSON)", async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(400);
  });

  it("rejects body with missing name field", async () => {
    const res = await POST(makeRequest({ description: "no name" }));
    expect(res.status).toBe(400);
  });

  it("rejects too-long description", async () => {
    const name = `DescBot-${Date.now()}`;
    const res = await POST(makeRequest({ name, description: "x".repeat(501) }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid avatarUrl", async () => {
    const name = `AvatarBot-${Date.now()}`;
    const res = await POST(makeRequest({ name, avatarUrl: "javascript:alert(1)" }));
    expect(res.status).toBe(400);
  });

  // --- Duplicate / auth ---

  it("rejects duplicate name without api key", async () => {
    const name = `DupeBot-${Date.now()}`;
    await POST(makeRequest({ name }));
    const res = await POST(makeRequest({ name }));
    expect(res.status).toBe(409);
  });

  it("rejects re-queue with wrong api key", async () => {
    const name = `WrongKey-${Date.now()}`;
    await POST(makeRequest({ name }));

    const res = await POST(makeRequest(
      { name },
      { "x-agent-key": "ak_bogus_0000000000000000000000000000" },
    ));
    expect(res.status).toBe(409);
  });

  // --- Status-gated re-queue ---

  it("does not re-queue agent in BANNED status", async () => {
    const name = `BannedBot-${Date.now()}`;
    const ip = "test-banned-" + Date.now();
    const createRes = await POST(makeRequest({ name }, { "x-forwarded-for": ip }));
    const createData = await createRes.json();

    const agent = db.getAgent(createData.agentId)!;
    db.updateAgent({ ...agent, status: AgentStatus.BANNED, updatedAt: new Date() });
    const { leaveQueue } = await import("@/lib/services/queue-service");
    try { leaveQueue(createData.agentId); } catch { /* may not be in queue */ }

    const res = await POST(makeRequest(
      { name },
      { "x-agent-key": createData.apiKey, "x-forwarded-for": ip },
    ));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("BANNED");
    expect(data.position).toBeUndefined();
    expect(data.queueId).toBeUndefined();
  });

  it("does not re-queue agent in IN_MATCH status", async () => {
    const name = `MatchBot-${Date.now()}`;
    const ip = "test-match-" + Date.now();
    const createRes = await POST(makeRequest({ name }, { "x-forwarded-for": ip }));
    const createData = await createRes.json();

    const agent = db.getAgent(createData.agentId)!;
    db.updateAgent({ ...agent, status: AgentStatus.IN_MATCH, updatedAt: new Date() });
    const { leaveQueue } = await import("@/lib/services/queue-service");
    try { leaveQueue(createData.agentId); } catch { /* may not be in queue */ }

    const res = await POST(makeRequest(
      { name },
      { "x-agent-key": createData.apiKey, "x-forwarded-for": ip },
    ));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("IN_MATCH");
    expect(data.position).toBeUndefined();
  });

  // --- Slug collision ---

  it("handles slug collision gracefully", async () => {
    const ts = Date.now();
    const res1 = await POST(makeRequest({ name: `SlugA${ts}` }));
    expect(res1.status).toBe(201);

    const res2 = await POST(makeRequest({ name: `sluga${ts}` }));
    expect(res2.status).toBe(409);
  });
});
