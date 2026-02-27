/**
 * Sliding window rate limiter (PRD §2.5)
 * Per API key: 10 req/s; Per IP: 30 req/s
 * Burst: up to 2x within 100ms, smoothed over 1s
 * In-memory Map-based (MVP)
 */

import { NextResponse } from "next/server";

interface WindowEntry {
  timestamps: number[];
}

const keyWindows = new Map<string, WindowEntry>();
const ipWindows = new Map<string, WindowEntry>();

// Cleanup stale entries periodically
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup(map: Map<string, WindowEntry>, now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of map) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 1000);
    if (entry.timestamps.length === 0) map.delete(key);
  }
}

function checkLimit(
  map: Map<string, WindowEntry>,
  id: string,
  limit: number,
  now: number,
): { allowed: boolean; retryAfterMs: number } {
  const entry = map.get(id) ?? { timestamps: [] };

  // Remove timestamps older than 1s
  entry.timestamps = entry.timestamps.filter((t) => now - t >= 0 && now - t < 1000);

  // Check burst: count within last 100ms
  const burstCount = entry.timestamps.filter((t) => now - t < 100).length;
  const burstLimit = limit * 2;

  if (burstCount >= burstLimit) {
    map.set(id, entry);
    const oldest = entry.timestamps[0] ?? now;
    const retryAfterMs = Math.max(1, 1000 - (now - oldest));
    return { allowed: false, retryAfterMs };
  }

  // Check sliding window: count within last 1s
  if (entry.timestamps.length >= limit) {
    map.set(id, entry);
    const oldest = entry.timestamps[0] ?? now;
    const retryAfterMs = Math.max(1, 1000 - (now - oldest));
    return { allowed: false, retryAfterMs };
  }

  entry.timestamps.push(now);
  map.set(id, entry);
  return { allowed: true, retryAfterMs: 0 };
}

export interface RateLimitResult {
  allowed: boolean;
  response?: NextResponse;
}

/**
 * Check rate limit for a request.
 * @param apiKey - API key if authenticated, null for public
 * @param ip - Client IP for public endpoint limiting
 */
export function checkRateLimit(apiKey: string | null, ip: string): RateLimitResult {
  const now = Date.now();
  cleanup(keyWindows, now);
  cleanup(ipWindows, now);

  if (apiKey) {
    const result = checkLimit(keyWindows, apiKey, 10, now);
    if (!result.allowed) {
      const retryAfter = Math.ceil(result.retryAfterMs / 1000);
      return {
        allowed: false,
        response: NextResponse.json(
          { error: "RATE_LIMITED", message: "Too many requests" },
          { status: 429, headers: { "Retry-After": String(retryAfter) } },
        ),
      };
    }
  } else {
    const result = checkLimit(ipWindows, ip, 30, now);
    if (!result.allowed) {
      const retryAfter = Math.ceil(result.retryAfterMs / 1000);
      return {
        allowed: false,
        response: NextResponse.json(
          { error: "RATE_LIMITED", message: "Too many requests" },
          { status: 429, headers: { "Retry-After": String(retryAfter) } },
        ),
      };
    }
  }

  return { allowed: true };
}

/** Reset all rate limit state (for testing) */
export function resetRateLimiter(): void {
  keyWindows.clear();
  ipWindows.clear();
}
