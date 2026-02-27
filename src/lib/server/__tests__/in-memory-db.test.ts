import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../in-memory-db";
import { AgentStatus, DEFAULT_AGENT_SETTINGS } from "@/types";
import type { AgentRecord, QueueEntry, QualificationMatch } from "@/types";

function makeAgent(id: string, name: string): AgentRecord {
  return {
    id,
    name,
    keyHash: "hash-" + id,
    status: AgentStatus.REGISTERED,
    elo: 1500,
    createdAt: new Date(),
    updatedAt: new Date(),
    queueCooldownUntil: null,
    queueBanUntil: null,
    consecutiveTimeouts: 0,
    suspiciousFlag: false,
    settings: { ...DEFAULT_AGENT_SETTINGS },
    consecutiveMatches: 0,
  };
}

describe("in-memory-db new collections", () => {
  beforeEach(() => {
    db.reset();
  });

  describe("agents", () => {
    it("creates and retrieves agent", () => {
      const agent = makeAgent("agent-foo", "Foo");
      db.createAgent(agent);
      expect(db.getAgent("agent-foo")).toEqual(agent);
      expect(db.getAgentByKeyHash("hash-agent-foo")).toEqual(agent);
      expect(db.getAgentByName("foo")).toEqual(agent);
    });

    it("returns null for unknown agent", () => {
      expect(db.getAgent("nope")).toBeNull();
    });

    it("counts agents", () => {
      db.createAgent(makeAgent("a1", "A1"));
      db.createAgent(makeAgent("a2", "A2"));
      expect(db.agentCount()).toBe(2);
    });

    it("lists all agents", () => {
      db.createAgent(makeAgent("a1", "A1"));
      expect(db.listAgents().length).toBe(1);
    });
  });

  describe("queue entries", () => {
    it("creates and retrieves queue entry", () => {
      const entry: QueueEntry = {
        id: "q-1",
        agentId: "agent-1",
        joinedAt: new Date(),
        lastActivityAt: new Date(),
        status: "WAITING",
      };
      db.createQueueEntry(entry);
      expect(db.getQueueEntry("q-1")).toEqual(entry);
      expect(db.getQueueEntryByAgent("agent-1")).toEqual(entry);
    });

    it("lists WAITING entries sorted by joinedAt", () => {
      const e1: QueueEntry = { id: "q-1", agentId: "a1", joinedAt: new Date("2026-01-01"), lastActivityAt: new Date(), status: "WAITING" };
      const e2: QueueEntry = { id: "q-2", agentId: "a2", joinedAt: new Date("2026-01-02"), lastActivityAt: new Date(), status: "WAITING" };
      db.createQueueEntry(e2);
      db.createQueueEntry(e1);
      const waiting = db.listQueueEntries("WAITING");
      expect(waiting[0].id).toBe("q-1");
      expect(waiting[1].id).toBe("q-2");
    });
  });

  describe("qualification matches", () => {
    it("creates and retrieves", () => {
      const qm: QualificationMatch = {
        id: "qual-1",
        agentId: "agent-1",
        difficulty: "easy",
        rounds: [],
        result: "PENDING",
        startedAt: new Date(),
        completedAt: null,
      };
      db.createQualificationMatch(qm);
      expect(db.getQualificationMatch("qual-1")).toEqual(qm);
      expect(db.listQualificationMatchesByAgent("agent-1")).toHaveLength(1);
    });
  });
});
