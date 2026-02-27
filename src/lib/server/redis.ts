/**
 * Upstash Redis client for state persistence across Vercel serverless instances.
 *
 * Pattern: write-through snapshot
 * - All reads stay synchronous (in-memory Maps)
 * - After writes, entire state is persisted to Redis (fire-and-forget)
 * - On cold start, state is loaded from Redis before first request
 */

import { Redis } from "@upstash/redis";

const STATE_KEY = "arena:state:v1";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

// ─── JSON Serialization (handles Date + Set) ────────────

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return { __type: "Date", v: value.toISOString() };
  if (value instanceof Set) return { __type: "Set", v: [...value] };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && "__type" in (value as Record<string, unknown>)) {
    const obj = value as { __type: string; v: unknown };
    if (obj.__type === "Date") return new Date(obj.v as string);
    if (obj.__type === "Set") return new Set(obj.v as unknown[]);
  }
  return value;
}

export function serializeState(state: Record<string, unknown>): string {
  return JSON.stringify(state, replacer);
}

export function deserializeState(raw: string): Record<string, unknown> {
  return JSON.parse(raw, reviver) as Record<string, unknown>;
}

// ─── Persist / Load ─────────────────────────────────────

let persistPromise: Promise<void> | null = null;
let persistQueued = false;

export function persistToRedis(getState: () => Record<string, unknown>): void {
  const r = getRedis();
  if (!r) return;

  // Debounce: if a persist is in flight, queue one more after it finishes
  if (persistPromise) {
    persistQueued = true;
    return;
  }

  const run = async () => {
    try {
      const serialized = serializeState(getState());
      await r.set(STATE_KEY, serialized);
    } catch (err) {
      console.error("[Redis] persist error:", err);
    }
    persistPromise = null;
    if (persistQueued) {
      persistQueued = false;
      persistToRedis(getState);
    }
  };

  persistPromise = run();
}

export async function loadFromRedis(): Promise<Record<string, unknown> | null> {
  const r = getRedis();
  if (!r) return null;

  try {
    const raw = await r.get<string>(STATE_KEY);
    if (!raw) return null;
    // Upstash may return parsed object or string
    if (typeof raw === "string") return deserializeState(raw);
    // Already parsed by Upstash client — but Dates/Sets need revival
    return deserializeState(JSON.stringify(raw));
  } catch (err) {
    console.error("[Redis] load error:", err);
    return null;
  }
}
