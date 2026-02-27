/**
 * Agent authentication (PRD §2.2)
 * - API key format: ak_live_xxxxxxxxxxxx
 * - Timing-safe compare via key hash
 * - Agent lookup by SHA-256 hash of key (never store plaintext)
 */

import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { db } from "./in-memory-db";

/** Legacy dev keys — kept for backward compat during transition */
const LEGACY_KEYS: Record<string, string> = {
  "agent-a": process.env.AGENT_A_KEY || "dev-key-a",
  "agent-b": process.env.AGENT_B_KEY || "dev-key-b",
};

/** Hash an API key with SHA-256 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Generate a new API key: ak_live_ + 32 random hex chars */
export function generateApiKey(): string {
  return `ak_live_${randomBytes(16).toString("hex")}`;
}

/** Timing-safe string comparison */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify agent auth from request header.
 * Checks new hash-based agents first, then falls back to legacy keys.
 */
export function verifyAgentAuth(
  request: Request,
  agentId: string,
): { valid: boolean; error?: string } {
  const apiKey = request.headers.get("x-agent-key");
  if (!apiKey) return { valid: false, error: "Missing x-agent-key header" };

  // Try new agent system (hash-based lookup)
  const agent = db.getAgent(agentId);
  if (agent) {
    const keyHash = hashApiKey(apiKey);
    if (timingSafeCompare(keyHash, agent.keyHash)) {
      return { valid: true };
    }
    return { valid: false, error: "Invalid API key" };
  }

  // Legacy fallback
  const expected = LEGACY_KEYS[agentId];
  if (!expected) return { valid: false, error: "Unknown agent" };
  if (apiKey !== expected) return { valid: false, error: "Invalid API key" };

  return { valid: true };
}

/**
 * Authenticate request by API key (new system).
 * Returns the agent ID if valid, or null.
 */
export function authenticateByKey(
  request: Request,
): { agentId: string; valid: true } | { valid: false; error: string } {
  const apiKey = request.headers.get("x-agent-key");
  if (!apiKey) return { valid: false, error: "Missing x-agent-key header" };

  const keyHash = hashApiKey(apiKey);
  const agent = db.getAgentByKeyHash(keyHash);
  if (!agent) {
    // Legacy fallback
    for (const [id, key] of Object.entries(LEGACY_KEYS)) {
      if (apiKey === key) return { agentId: id, valid: true };
    }
    return { valid: false, error: "Invalid API key" };
  }

  return { agentId: agent.id, valid: true };
}
