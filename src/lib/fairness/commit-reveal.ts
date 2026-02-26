import { Move } from "@/types";
import { createHash, randomBytes } from "node:crypto";

/**
 * Builds canonical nonce key for anti-replay checks.
 */
export function buildRevealNonce(roundId: string, agentId: string, salt: string): string {
  return `${roundId}::${agentId}::${salt}`;
}

/**
 * Deterministically generates commit hash.
 * hash = SHA-256(move + salt + roundId + agentId)
 */
export function generateCommit(move: Move, salt: string, roundId: string, agentId: string): string {
  if (!salt) throw new Error("Salt is required to generate commit hash.");
  if (!roundId) throw new Error("roundId is required to generate commit hash.");
  if (!agentId) throw new Error("agentId is required to generate commit hash.");

  const payload = `${move}|${salt}|${roundId}|${agentId}`;
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Verifies submitted reveal payload against expected commit hash.
 */
export function verifyCommit(
  commitHash: string,
  move: Move,
  salt: string,
  roundId: string,
  agentId: string,
): boolean {
  if (!commitHash) {
    throw new Error("commitHash is required.");
  }

  const expected = generateCommit(move, salt, roundId, agentId);
  return commitHash === expected;
}

/**
 * Generates a cryptographically secure reveal salt.
 */
export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Ensures reveal nonce has not been used before (anti-replay).
 *
 * Returns true when nonce was newly registered, false when replayed.
 */
export function verifyAndRegisterNonce(
  nonce: string,
  usedNonces: Set<string>,
): boolean {
  if (!nonce) throw new Error("nonce is required for anti-replay check.");

  if (usedNonces.has(nonce)) {
    return false;
  }

  usedNonces.add(nonce);
  return true;
}
