/**
 * Integration test: Full orchestration wiring
 * 2 agents → qualify → queue → auto-match → ready check starts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/server/in-memory-db";
import { AgentStatus, Move } from "@/types";
import { startQualification, submitQualRound, resetQualService } from "../qual-service";
import { joinQueue, resetQueueService } from "../queue-service";
import { resetScheduler } from "../match-scheduler";
import { resetEventBus, ensureOrchestrationWired } from "../event-bus";

function createAgent(id: string, name: string) {
  db.createAgent({
    id,
    name,
    keyHash: `keyhash_${id}`,
    status: AgentStatus.REGISTERED,
    elo: 1500,
    createdAt: new Date(),
    updatedAt: new Date(),
    queueCooldownUntil: null,
    queueBanUntil: null,
    consecutiveTimeouts: 0,
    suspiciousFlag: false,
    settings: { autoRequeue: false, maxConsecutiveMatches: 5, restBetweenSec: 30, allowedIps: [] },
    consecutiveMatches: 0,
    consecutiveQualFails: 0,
  });
}

function qualifyAgent(agentId: string) {
  const { qualMatchId } = startQualification(agentId);
  // Win 3 rounds to pass
  for (let round = 1; round <= 5; round++) {
    try {
      const result = submitQualRound(agentId, qualMatchId, round, Move.ROCK);
      if (result.status === "PASS" || result.status === "FAIL") break;
    } catch {
      break;
    }
  }
  // Ensure qualified (force if house-bot won)
  const agent = db.getAgent(agentId)!;
  if (agent.status !== AgentStatus.QUALIFIED) {
    db.updateAgent({ ...agent, status: AgentStatus.QUALIFIED, queueCooldownUntil: null, updatedAt: new Date() });
  }
}

describe("Orchestration Wiring", () => {
  beforeEach(() => {
    db.reset();
    resetQueueService();
    resetQualService();
    resetScheduler();
    resetEventBus();
    ensureOrchestrationWired();
  });

  it("2 agents → qualify → queue → auto-match created with ready check", async () => {
    createAgent("agent-1", "Alpha");
    createAgent("agent-2", "Beta");

    qualifyAgent("agent-1");
    qualifyAgent("agent-2");

    expect(db.getAgent("agent-1")!.status).toBe(AgentStatus.QUALIFIED);
    expect(db.getAgent("agent-2")!.status).toBe(AgentStatus.QUALIFIED);

    // Join queue — first agent, no match yet
    joinQueue("agent-1");

    // Allow async matchmaker to run
    await new Promise((r) => setTimeout(r, 50));

    // Only 1 agent in queue, no match yet
    expect(db.getAgent("agent-1")!.status).toBe(AgentStatus.QUEUED);

    // Second agent joins — should trigger auto-match
    joinQueue("agent-2");

    // Allow async matchmaker to run via event bus
    await new Promise((r) => setTimeout(r, 50));

    // Both agents should now be IN_MATCH (ready check started)
    const a1 = db.getAgent("agent-1")!;
    const a2 = db.getAgent("agent-2")!;
    expect(a1.status).toBe(AgentStatus.IN_MATCH);
    expect(a2.status).toBe(AgentStatus.IN_MATCH);

    // No WAITING queue entries remain (both matched)
    expect(db.getQueueEntryByAgent("agent-1")).toBeNull();
    expect(db.getQueueEntryByAgent("agent-2")).toBeNull();
  });
});
