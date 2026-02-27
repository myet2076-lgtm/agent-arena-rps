import { describe, it, expect, beforeEach } from "vitest";
import { tryMatch } from "../matchmaker";
import { db } from "@/lib/server/in-memory-db";
import { AgentStatus } from "@/types";
import { hashApiKey } from "@/lib/server/auth";
import { resetQueueEvents } from "../queue-events";

function createQueuedAgent(id: string, joinedAt?: Date) {
  db.createAgent({
    id,
    name: `Agent ${id}`,
    keyHash: hashApiKey(`key-${id}`),
    status: AgentStatus.QUEUED,
    elo: 1500,
    createdAt: new Date(),
    updatedAt: new Date(),
    queueCooldownUntil: null,
    queueBanUntil: null,
    consecutiveTimeouts: 0,
    suspiciousFlag: false,
    settings: { autoRequeue: false, maxConsecutiveMatches: 5, restBetweenSec: 30, allowedIps: [] },
    consecutiveMatches: 0,
    consecutiveQualFails: 0, qualifiedAt: null, lastQualFailAt: null,
  });

  const now = joinedAt ?? new Date();
  db.createQueueEntry({
    id: `q-${id}`,
    agentId: id,
    joinedAt: now,
    lastActivityAt: now,
    lastSSEPing: null,
    lastPollTimestamp: null,
    sseDisconnectedAt: null,
    status: "WAITING",
  });
}

describe("Matchmaker", () => {
  beforeEach(() => {
    db.reset();
    resetQueueEvents();
  });

  it("returns null when fewer than 2 waiting", () => {
    expect(tryMatch()).toBeNull();

    createQueuedAgent("m1");
    expect(tryMatch()).toBeNull();
  });

  it("matches two waiting agents", () => {
    createQueuedAgent("m1", new Date(Date.now() - 2000));
    createQueuedAgent("m2", new Date(Date.now() - 1000));

    const result = tryMatch();
    expect(result).toBeTruthy();
    expect(result!.agentA).toBe("m1");
    expect(result!.agentB).toBe("m2");

    // Agents should be IN_MATCH (startReadyCheck transitions MATCHED → IN_MATCH)
    expect(db.getAgent("m1")!.status).toBe(AgentStatus.IN_MATCH);
    expect(db.getAgent("m2")!.status).toBe(AgentStatus.IN_MATCH);

    // Queue entries should be MATCHED
    expect(db.getQueueEntry("q-m1")!.status).toBe("MATCHED");
    expect(db.getQueueEntry("q-m2")!.status).toBe("MATCHED");

    // Match should exist
    const match = db.getMatch(result!.matchId);
    expect(match).toBeTruthy();
  });

  it("follows FIFO ordering", () => {
    createQueuedAgent("m-old", new Date(Date.now() - 5000));
    createQueuedAgent("m-mid", new Date(Date.now() - 3000));
    createQueuedAgent("m-new", new Date(Date.now() - 1000));

    const result = tryMatch();
    expect(result!.agentA).toBe("m-old");
    expect(result!.agentB).toBe("m-mid");

    // m-new should still be waiting
    expect(db.listQueueEntries("WAITING")).toHaveLength(1);
    expect(db.listQueueEntries("WAITING")[0].agentId).toBe("m-new");
  });
});
