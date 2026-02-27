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
 * Canonical format: sha256("{MOVE}:{SALT}") — uppercase move, colon separator.
 * Matches the API verification in reveal route.
 */
export function generateCommit(move: Move, salt: string): string {
  if (!salt) throw new Error("Salt is required to generate commit hash.");
  const payload = `${move.toUpperCase()}:${salt}`;
  return createHash("sha256").update(payload, "utf-8").digest("hex");
}

/**
 * Verifies submitted reveal payload against expected commit hash.
 * Canonical format: sha256("{MOVE}:{SALT}").
 */
export function verifyCommit(
  commitHash: string,
  move: Move,
  salt: string,
): boolean {
  if (!commitHash) {
    throw new Error("commitHash is required.");
  }

  const expected = generateCommit(move, salt);
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
