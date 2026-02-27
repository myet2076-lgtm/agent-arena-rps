import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST, DELETE } from "../route";
import { GET as getMe } from "../me/route";
import { GET as getEvents } from "../events/route";
import { db } from "@/lib/server/in-memory-db";
import { AgentStatus, DEFAULT_AGENT_SETTINGS, MatchStatus } from "@/types";
import { hashApiKey } from "@/lib/server/auth";
import { resetRateLimiter } from "@/lib/server/rate-limiter";
import { resetQueueService } from "@/lib/services/queue-service";

const TEST_KEY = "ak_live_queuetest1234567890abcde";

function setupAgent(
  id: string = "agent-qbot",
  status: AgentStatus = AgentStatus.QUALIFIED,
  apiKey: string = TEST_KEY,
) {
  db.createAgent({
    id,
    name: `QBot-${id}`,
    keyHash: hashApiKey(apiKey),
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
    consecutiveQualFails: 0, qualifiedAt: null, lastQualFailAt: null,
  });
}

function authReq(method: string, url: string = "http://localhost/api/queue", apiKey: string = TEST_KEY): Request {
  return new Request(url, {
    method,
    headers: { "x-agent-key": apiKey },
  });
}

async function readSseChunk(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  return new TextDecoder().decode(value ?? new Uint8Array());
}

function extractFirstEventPayload(chunk: string): { eventType: string; payload: any } {
  const eventMatch = chunk.match(/event: ([^\n]+)/);
  const dataMatch = chunk.match(/data: (\{.*\})/);
  return {
    eventType: eventMatch?.[1] ?? "",
    payload: dataMatch ? JSON.parse(dataMatch[1]) : null,
  };
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
      expect(body.queueLength).toBe(0);
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

    it("returns MATCHED payload after assignment", async () => {
      const keyA = TEST_KEY;
      const keyB = "ak_live_queuetest_second_agent_key1";
      setupAgent("agent-a", AgentStatus.MATCHED, keyA);
      setupAgent("agent-b", AgentStatus.MATCHED, keyB);

      const now = new Date();
      const readyDeadline = new Date(now.getTime() + 30_000);
      db.createQueueEntry({
        id: "qe-agent-a",
        agentId: "agent-a",
        joinedAt: now,
        lastActivityAt: now,
        lastSSEPing: null,
        lastPollTimestamp: null,
        sseDisconnectedAt: null,
        status: "MATCHED",
      });
      db.updateMatch({
        id: "match-ready-1",
        seasonId: "season-1",
        agentA: "agent-a",
        agentB: "agent-b",
        status: MatchStatus.CREATED,
        format: "BO7",
        scoreA: 0,
        scoreB: 0,
        winsA: 0,
        winsB: 0,
        currentRound: 0,
        maxRounds: 12,
        winnerId: null,
        startedAt: now,
        finishedAt: null,
        createdAt: now,
        readyA: false,
        readyB: false,
        readyDeadline,
        currentPhase: "READY_CHECK",
        phaseDeadline: readyDeadline,
        eloChangeA: null,
        eloChangeB: null,
        eloUpdatedAt: null,
      });

      const res = await getMe(authReq("GET", "http://localhost/api/queue/me"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        status: "MATCHED",
        matchId: "match-ready-1",
        opponent: {
          id: "agent-b",
          name: "QBot-agent-b",
          elo: 1500,
        },
        readyDeadline: readyDeadline.toISOString(),
      });
    });

    it("returns NOT_IN_QUEUE when not in queue", async () => {
      setupAgent();
      const res = await getMe(authReq("GET", "http://localhost/api/queue/me"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("NOT_IN_QUEUE");
    });
  });

  describe("GET /api/queue/events", () => {
    it("returns 401 MISSING_KEY without API key", async () => {
      const res = await getEvents(new Request("http://localhost/api/queue/events"));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("MISSING_KEY");
    });

    it("returns 401 INVALID_KEY with unknown API key", async () => {
      const res = await getEvents(new Request("http://localhost/api/queue/events", {
        headers: { "x-agent-key": "ak_live_invalid000000000000000" },
      }));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("INVALID_KEY");
    });

    it("returns 403 NOT_QUALIFIED for invalid lifecycle state", async () => {
      setupAgent("agent-nq", AgentStatus.REGISTERED);
      const res = await getEvents(new Request("http://localhost/api/queue/events", {
        headers: { "x-agent-key": TEST_KEY },
      }));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("NOT_QUALIFIED");
    });

    it("allows QUALIFIED/QUEUED/MATCHED lifecycle path", async () => {
      setupAgent("agent-q", AgentStatus.QUALIFIED);
      let res = await getEvents(new Request("http://localhost/api/queue/events", {
        headers: { "x-agent-key": TEST_KEY },
      }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");

      db.reset();
      resetRateLimiter();
      resetQueueService();
      setupAgent("agent-queued", AgentStatus.QUALIFIED);
      await POST(authReq("POST"));
      res = await getEvents(new Request("http://localhost/api/queue/events", {
        headers: { "x-agent-key": TEST_KEY },
      }));
      expect(res.status).toBe(200);

      db.reset();
      resetRateLimiter();
      resetQueueService();
      setupAgent("agent-m", AgentStatus.MATCHED, TEST_KEY);
      setupAgent("agent-o", AgentStatus.MATCHED, "ak_live_other_agent_key_for_events01");
      const now = new Date();
      const readyDeadline = new Date(now.getTime() + 30_000);
      db.createQueueEntry({
        id: "qe-agent-m",
        agentId: "agent-m",
        joinedAt: now,
        lastActivityAt: now,
        lastSSEPing: null,
        lastPollTimestamp: null,
        sseDisconnectedAt: null,
        status: "MATCHED",
      });
      db.updateMatch({
        id: "m-events-1",
        seasonId: "season-1",
        agentA: "agent-m",
        agentB: "agent-o",
        status: MatchStatus.CREATED,
        format: "BO7",
        scoreA: 0,
        scoreB: 0,
        winsA: 0,
        winsB: 0,
        currentRound: 0,
        maxRounds: 12,
        winnerId: null,
        startedAt: now,
        finishedAt: null,
        createdAt: now,
        readyA: false,
        readyB: false,
        readyDeadline,
        currentPhase: "READY_CHECK",
        phaseDeadline: readyDeadline,
        eloChangeA: null,
        eloChangeB: null,
        eloUpdatedAt: null,
      });
      res = await getEvents(new Request("http://localhost/api/queue/events", {
        headers: { "x-agent-key": TEST_KEY },
      }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    });

    it("emits exact POSITION_UPDATE payload schema", async () => {
      setupAgent("agent-queued", AgentStatus.QUALIFIED);
      await POST(authReq("POST"));
      const res = await getEvents(new Request("http://localhost/api/queue/events", {
        headers: { "x-agent-key": TEST_KEY },
      }));
      const chunk = await readSseChunk(res);
      const { eventType, payload } = extractFirstEventPayload(chunk);
      expect(eventType).toBe("POSITION_UPDATE");
      expect(payload).toEqual({ position: 1, estimatedWaitSec: 30 });
      expect(Object.keys(payload).sort()).toEqual(["estimatedWaitSec", "position"]);
    });

    it("emits exact MATCH_ASSIGNED payload schema", async () => {
      setupAgent("agent-m", AgentStatus.MATCHED, TEST_KEY);
      setupAgent("agent-o", AgentStatus.MATCHED, "ak_live_other_agent_key_for_events01");
      const now = new Date();
      const readyDeadline = new Date(now.getTime() + 30_000);
      db.createQueueEntry({
        id: "qe-agent-m",
        agentId: "agent-m",
        joinedAt: now,
        lastActivityAt: now,
        lastSSEPing: null,
        lastPollTimestamp: null,
        sseDisconnectedAt: null,
        status: "MATCHED",
      });
      db.updateMatch({
        id: "m-events-2",
        seasonId: "season-1",
        agentA: "agent-m",
        agentB: "agent-o",
        status: MatchStatus.CREATED,
        format: "BO7",
        scoreA: 0,
        scoreB: 0,
        winsA: 0,
        winsB: 0,
        currentRound: 0,
        maxRounds: 12,
        winnerId: null,
        startedAt: now,
        finishedAt: null,
        createdAt: now,
        readyA: false,
        readyB: false,
        readyDeadline,
        currentPhase: "READY_CHECK",
        phaseDeadline: readyDeadline,
        eloChangeA: null,
        eloChangeB: null,
        eloUpdatedAt: null,
      });

      const res = await getEvents(new Request("http://localhost/api/queue/events", {
        headers: { "x-agent-key": TEST_KEY },
      }));
      const chunk = await readSseChunk(res);
      const { eventType, payload } = extractFirstEventPayload(chunk);
      expect(eventType).toBe("MATCH_ASSIGNED");
      expect(payload).toEqual({
        matchId: "m-events-2",
        opponent: { id: "agent-o", name: "QBot-agent-o", elo: 1500 },
        readyDeadline: readyDeadline.toISOString(),
      });
      expect(Object.keys(payload).sort()).toEqual(["matchId", "opponent", "readyDeadline"]);
    });

    it("emits exact REMOVED payload schema for QUALIFIED snapshot", async () => {
      setupAgent("agent-q", AgentStatus.QUALIFIED, TEST_KEY);
      const res = await getEvents(new Request("http://localhost/api/queue/events", {
        headers: { "x-agent-key": TEST_KEY },
      }));
      const chunk = await readSseChunk(res);
      const { eventType, payload } = extractFirstEventPayload(chunk);
      expect(eventType).toBe("REMOVED");
      expect(payload).toEqual({ reason: "MANUAL" });
      expect(Object.keys(payload)).toEqual(["reason"]);
    });
  });
});
