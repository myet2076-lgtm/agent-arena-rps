import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST, DELETE } from "../route";
import { GET as getMe } from "../me/route";
import { db } from "@/lib/server/in-memory-db";
import { AgentStatus, DEFAULT_AGENT_SETTINGS } from "@/types";
import { hashApiKey } from "@/lib/server/auth";
import { resetRateLimiter } from "@/lib/server/rate-limiter";
import { resetQueueService } from "@/lib/services/queue-service";

const TEST_KEY = "ak_live_queuetest1234567890abcde";

function setupAgent(id: string = "agent-qbot", status: AgentStatus = AgentStatus.QUALIFIED) {
  db.createAgent({
    id,
    name: `QBot-${id}`,
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
  });
}

function authReq(method: string, url: string = "http://localhost/api/queue"): Request {
  return new Request(url, {
    method,
    headers: { "x-agent-key": TEST_KEY },
  });
}

describe("Queue API", () => {
  beforeEach(() => {
    db.reset();
    resetRateLimiter();
    resetQueueService();
  });

  describe("GET /api/queue (public)", () => {
    it("returns empty queue", async () => {
      const res = await GET(new Request("http://localhost/api/queue"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.queue).toEqual([]);
      expect(body.total).toBe(0);
    });
  });

  describe("POST /api/queue", () => {
    it("joins queue for qualified agent", async () => {
      setupAgent();
      const res = await POST(authReq("POST"));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.position).toBe(1);
      expect(body.queueId).toBeTruthy();
    });

    it("rejects non-qualified agent", async () => {
      setupAgent("agent-qbot", AgentStatus.REGISTERED);
      const res = await POST(authReq("POST"));
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/queue", () => {
    it("leaves queue", async () => {
      setupAgent();
      await POST(authReq("POST"));
      const res = await DELETE(authReq("DELETE"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("LEFT");
    });

    it("is idempotent", async () => {
      setupAgent();
      const res = await DELETE(authReq("DELETE"));
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/queue/me", () => {
    it("returns position when in queue", async () => {
      setupAgent();
      await POST(authReq("POST"));
      const res = await getMe(authReq("GET", "http://localhost/api/queue/me"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.position).toBe(1);
    });

    it("404 when not in queue", async () => {
      setupAgent();
      const res = await getMe(authReq("GET", "http://localhost/api/queue/me"));
      expect(res.status).toBe(404);
    });
  });
});
