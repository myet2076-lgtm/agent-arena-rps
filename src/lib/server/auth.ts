/**
 * Agent authentication (PRD §2.2)
 * - API key format: ak_live_xxxxxxxxxxxx
 * - Timing-safe compare via key hash
 * - Agent lookup by SHA-256 hash of key (never store plaintext)
 */

import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { db } from "./in-memory-db";

/** Hash an API key with SHA-256 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Generate a new API key: ak_live_ + 32 random hex chars */
export function generateApiKey(): string {
  return `ak_live_${randomBytes(16).toString("hex")}`;
}

/**
 * Timing-safe string comparison.
 * Pads shorter buffer to equal length to avoid early-return on length mismatch.
 */
function timingSafeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const bufA = Buffer.alloc(maxLen, 0);
  const bufB = Buffer.alloc(maxLen, 0);
  Buffer.from(a, "utf-8").copy(bufA);
  Buffer.from(b, "utf-8").copy(bufB);
  // timingSafeEqual + explicit length check (constant-time)
  return timingSafeEqual(bufA, bufB) && a.length === b.length;
}

/**
 * Verify agent auth from request header.
 * Hash-based agents only (legacy keys removed).
 */
export function verifyAgentAuth(
  request: Request,
  agentId: string,
): { valid: boolean; error?: string } {
  const apiKey = request.headers.get("x-agent-key");
  if (!apiKey) return { valid: false, error: "Missing x-agent-key header" };

  const agent = db.getAgent(agentId);
  if (!agent) return { valid: false, error: "Unknown agent" };

  const keyHash = hashApiKey(apiKey);
  if (timingSafeCompare(keyHash, agent.keyHash)) {
    return { valid: true };
  }
  return { valid: false, error: "Invalid API key" };
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
    return { valid: false, error: "Invalid API key" };
  }

  return { agentId: agent.id, valid: true };
}
