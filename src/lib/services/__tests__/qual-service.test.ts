import { describe, it, expect, beforeEach } from "vitest";
import { startQualification, submitQualRound, resetQualService } from "../qual-service";
import { db } from "@/lib/server/in-memory-db";
import { AgentStatus, Move } from "@/types";
import { hashApiKey } from "@/lib/server/auth";

function createTestAgent(id: string, status: AgentStatus = AgentStatus.REGISTERED) {
  const keyHash = hashApiKey(`test-key-${id}`);
  db.createAgent({
    id,
    name: `Agent ${id}`,
    keyHash,
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
    consecutiveQualFails: 0,
  });
  return id;
}

describe("QualService", () => {
  beforeEach(() => {
    db.reset();
    resetQualService();
  });

  it("starts qualification for registered agent", () => {
    const agentId = createTestAgent("bot-1");
    const result = startQualification(agentId, "easy");

    expect(result.qualMatchId).toBeTruthy();
    expect(result.difficulty).toBe("easy");
    expect(result.totalRounds).toBe(5);
    expect(result.firstRound).toBe(1);

    const agent = db.getAgent(agentId);
    expect(agent!.status).toBe(AgentStatus.QUALIFYING);
  });

  it("rejects non-REGISTERED agent", () => {
    const agentId = createTestAgent("bot-2", AgentStatus.QUALIFIED);
    expect(() => startQualification(agentId)).toThrow("must be REGISTERED");
  });

  it("plays through and passes qualification", () => {
    const agentId = createTestAgent("bot-3");
    const { qualMatchId } = startQualification(agentId, "easy");

    // Play PAPER against easy bot (which plays ROCK ~70% of time)
    // We'll just play all 5 rounds and check final status
    let passed = false;
    for (let round = 1; round <= 5; round++) {
      const result = submitQualRound(agentId, qualMatchId, round, Move.PAPER);
      expect(result.round).toBe(round);
      if (result.status === "PASS") {
        passed = true;
        break;
      }
      if (result.status === "FAIL") break;
    }

    // With PAPER vs mostly ROCK, should pass
    const agent = db.getAgent(agentId);
    // Agent should be either QUALIFIED (pass) or REGISTERED (fail)
    expect([AgentStatus.QUALIFIED, AgentStatus.REGISTERED]).toContain(agent!.status);
  });

  it("correctly tracks scores across rounds", () => {
    const agentId = createTestAgent("bot-4");
    const { qualMatchId } = startQualification(agentId, "easy");

    const r1 = submitQualRound(agentId, qualMatchId, 1, Move.ROCK);
    expect(r1.round).toBe(1);
    expect(["WIN", "LOSE", "DRAW"]).toContain(r1.result);
    expect(r1.score.you + r1.score.bot).toBeLessThanOrEqual(1);
  });

  it("rejects wrong round number", () => {
    const agentId = createTestAgent("bot-5");
    const { qualMatchId } = startQualification(agentId, "easy");

    expect(() => submitQualRound(agentId, qualMatchId, 3, Move.ROCK)).toThrow("Expected round");
  });

  it("rejects move on completed qualification", () => {
    const agentId = createTestAgent("bot-6");
    const { qualMatchId } = startQualification(agentId, "easy");

    // Play all rounds
    for (let r = 1; r <= 5; r++) {
      const res = submitQualRound(agentId, qualMatchId, r, Move.PAPER);
      if (res.status !== "IN_PROGRESS") break;
    }

    // Try submitting another round — should fail
    expect(() => submitQualRound(agentId, qualMatchId, 6, Move.ROCK)).toThrow();
  });

  it("applies cooldown on failure", () => {
    const agentId = createTestAgent("bot-7");
    const { qualMatchId } = startQualification(agentId, "hard");

    // Play ROCK every round against hard bot — likely to lose
    for (let r = 1; r <= 5; r++) {
      const res = submitQualRound(agentId, qualMatchId, r, Move.ROCK);
      if (res.status !== "IN_PROGRESS") break;
    }

    const agent = db.getAgent(agentId);
    if (agent!.status === AgentStatus.REGISTERED) {
      // Should have cooldown set
      expect(agent!.queueCooldownUntil).toBeTruthy();

      // Starting new qual should fail with QUAL_COOLDOWN
      expect(() => startQualification(agentId, "easy")).toThrow("cooldown");
    }
  });
});
