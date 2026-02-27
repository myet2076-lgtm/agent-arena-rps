import { describe, it, expect, beforeEach } from "vitest";
import { generateApiKey, hashApiKey, verifyAgentAuth, authenticateByKey } from "../auth";
import { db } from "../in-memory-db";
import { AgentStatus, DEFAULT_AGENT_SETTINGS } from "@/types";
import type { AgentRecord } from "@/types";

function makeRequest(key?: string): Request {
  const headers: Record<string, string> = {};
  if (key) headers["x-agent-key"] = key;
  return new Request("http://localhost", { headers });
}

describe("auth", () => {
  beforeEach(() => {
    db.reset();
  });

  describe("generateApiKey", () => {
    it("generates key with ak_live_ prefix", () => {
      const key = generateApiKey();
      expect(key).toMatch(/^ak_live_[a-f0-9]{32}$/);
    });

    it("generates unique keys", () => {
      const keys = new Set(Array.from({ length: 10 }, () => generateApiKey()));
      expect(keys.size).toBe(10);
    });
  });

  describe("hashApiKey", () => {
    it("returns 64-char hex string", () => {
      const hash = hashApiKey("test-key");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("is deterministic", () => {
      expect(hashApiKey("test")).toBe(hashApiKey("test"));
    });
  });

  describe("verifyAgentAuth (new agents)", () => {
    it("validates via key hash", () => {
      const rawKey = generateApiKey();
      const agent: AgentRecord = {
        id: "agent-test",
        name: "Test",
        keyHash: hashApiKey(rawKey),
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
    consecutiveQualFails: 0, qualifiedAt: null, lastQualFailAt: null,
      };
      db.createAgent(agent);

      expect(verifyAgentAuth(makeRequest(rawKey), "agent-test").valid).toBe(true);
      expect(verifyAgentAuth(makeRequest("wrong"), "agent-test").valid).toBe(false);
    });

    it("rejects missing header", () => {
      expect(verifyAgentAuth(makeRequest(), "agent-test").valid).toBe(false);
    });
  });

  describe("authenticateByKey", () => {
    it("returns agentId for valid key", () => {
      const rawKey = generateApiKey();
      const agent: AgentRecord = {
        id: "agent-bot",
        name: "Bot",
        keyHash: hashApiKey(rawKey),
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
    consecutiveQualFails: 0, qualifiedAt: null, lastQualFailAt: null,
      };
      db.createAgent(agent);

      const result = authenticateByKey(makeRequest(rawKey));
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.agentId).toBe("agent-bot");
    });

    it("rejects unknown keys (no legacy fallback)", () => {
      const result = authenticateByKey(makeRequest("dev-key-a"));
      expect(result.valid).toBe(false);
    });
  });
});
