import { describe, it, expect, beforeEach } from "vitest";
import { joinQueue, leaveQueue, checkPosition, resetQueueService } from "../queue-service";
import { db } from "@/lib/server/in-memory-db";
import { AgentStatus } from "@/types";
import { hashApiKey } from "@/lib/server/auth";

function createAgent(id: string, status: AgentStatus = AgentStatus.QUALIFIED) {
  db.createAgent({
    id,
    name: `Agent ${id}`,
    keyHash: hashApiKey(`key-${id}`),
    status,
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
}

describe("QueueService", () => {
  beforeEach(() => {
    db.reset();
    resetQueueService();
  });

  it("joins queue for QUALIFIED agent", () => {
    createAgent("a1");
    const result = joinQueue("a1");
    expect(result.position).toBe(1);
    expect(result.queueId).toBeTruthy();

    const agent = db.getAgent("a1");
    expect(agent!.status).toBe(AgentStatus.QUEUED);
  });

  it("rejects non-QUALIFIED agent", () => {
    createAgent("a2", AgentStatus.REGISTERED);
    expect(() => joinQueue("a2")).toThrow();
  });

  it("leaves queue and restores status", () => {
    createAgent("a3");
    joinQueue("a3");
    const result = leaveQueue("a3");
    expect(result.status).toBe("LEFT");

    const agent = db.getAgent("a3");
    expect(agent!.status).toBe(AgentStatus.QUALIFIED);
  });

  it("leave is idempotent when not in queue", () => {
    createAgent("a4");
    const result = leaveQueue("a4");
    expect(result.status).toBe("NOT_IN_QUEUE");
  });

  it("derives correct position", () => {
    createAgent("a5");
    createAgent("a6");
    createAgent("a7");
    joinQueue("a5");
    joinQueue("a6");
    joinQueue("a7");

    const pos = checkPosition("a6");
    expect(pos.position).toBe(2);
  });

  it("updates heartbeat on checkPosition", () => {
    createAgent("a8");
    joinQueue("a8");

    const entry1 = db.getQueueEntryByAgent("a8");
    const before = entry1!.lastActivityAt.getTime();

    // Small delay
    const now = Date.now();
    while (Date.now() - now < 5) { /* spin */ }

    checkPosition("a8");
    const entry2 = db.getQueueEntryByAgent("a8");
    expect(entry2!.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("rejects after 3 join/leave cycles in 5 minutes", () => {
    createAgent("a9");

    for (let i = 0; i < 3; i++) {
      joinQueue("a9");
      leaveQueue("a9");
      // Re-set to QUALIFIED for next cycle
      const agent = db.getAgent("a9")!;
      db.updateAgent({ ...agent, status: AgentStatus.QUALIFIED });
    }

    expect(() => joinQueue("a9")).toThrow("Too many join/leave");
  });

  it("returns NOT_IN_QUEUE for checkPosition when not queued", () => {
    createAgent("a10");
    const result = checkPosition("a10");
    expect(result.status).toBe("NOT_IN_QUEUE");
  });
});
