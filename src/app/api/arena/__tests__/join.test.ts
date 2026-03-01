import { describe, expect, it, beforeEach, vi } from "vitest";
import { POST } from "../join/route";
import { db } from "@/lib/server/in-memory-db";

function makeRequest(body: Record<string, unknown>, headers?: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/arena/join", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "test-ip-" + Math.random(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/arena/join", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

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

  it("rejects invalid name", async () => {
    const res = await POST(makeRequest({ name: "ab" }));
    expect(res.status).toBe(400);
  });

  it("rejects duplicate name without api key", async () => {
    const name = `DupeBot-${Date.now()}`;
    await POST(makeRequest({ name }));
    const res = await POST(makeRequest({ name }));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(res.status).toBe(409);
  });

  it("re-queues existing agent with valid api key", async () => {
    const name = `RequeueBot-${Date.now()}`;
    const ip = "test-requeue-" + Date.now();
    const createRes = await POST(makeRequest({ name }, { "x-forwarded-for": ip }));
    const createData = await createRes.json();

    // Agent is now QUEUED, need to transition to POST_MATCH to re-queue
    const agent = db.getAgent(createData.agentId)!;
    db.updateAgent({ ...agent, status: "POST_MATCH" as never, updatedAt: new Date() });

    // Leave queue via service
    const { leaveQueue } = await import("@/lib/services/queue-service");
    leaveQueue(createData.agentId);

    const res = await POST(makeRequest(
      { name },
      { "x-agent-key": createData.apiKey, "x-forwarded-for": ip },
    ));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.isNewAgent).toBe(false);
    expect(data.status).toBe("QUEUED");
  });
});
