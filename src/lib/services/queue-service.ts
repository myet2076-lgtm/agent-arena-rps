/**
 * Queue Service (PRD §3.2, F03)
 * Join, leave, heartbeat, anti-abuse
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/in-memory-db";
import { ApiError } from "@/lib/server/api-error";
import { AgentStatus, type QueueEntry } from "@/types";
import { emitDomainEvent } from "./event-bus";

const ANTI_ABUSE_WINDOW_MS = 5 * 60_000; // 5 minutes
const ANTI_ABUSE_MAX_CYCLES = 3;
const ANTI_ABUSE_COOLDOWN_MS = 5 * 60_000; // 5 min cooldown

// Track join/leave cycles per agent: agentId -> timestamps of joins
const joinCycles = new Map<string, number[]>();

function checkAntiAbuse(agentId: string): void {
  const now = Date.now();
  const cycles = (joinCycles.get(agentId) ?? []).filter((t) => now - t < ANTI_ABUSE_WINDOW_MS);
  if (cycles.length >= ANTI_ABUSE_MAX_CYCLES) {
    // Set durable cooldown on agent record
    const agent = db.getAgent(agentId);
    if (agent) {
      db.updateAgent({
        ...agent,
        queueCooldownUntil: new Date(now + ANTI_ABUSE_COOLDOWN_MS),
        updatedAt: new Date(),
      });
    }
    throw new ApiError(429, "QUEUE_COOLDOWN", "Too many join/leave cycles, wait 5 minutes");
  }
}

function recordJoinCycle(agentId: string): void {
  const now = Date.now();
  const cycles = (joinCycles.get(agentId) ?? []).filter((t) => now - t < ANTI_ABUSE_WINDOW_MS);
  cycles.push(now);
  joinCycles.set(agentId, cycles);
}

export function joinQueue(agentId: string): { position: number; estimatedWaitSec: number; queueId: string } {
  const agent = db.getAgent(agentId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found");

  if (agent.status !== AgentStatus.QUALIFIED && agent.status !== AgentStatus.POST_MATCH) {
    throw new ApiError(403, "NOT_QUALIFIED", `Agent status is ${agent.status}, must be QUALIFIED or POST_MATCH`);
  }

  // Check queue ban (PRD F03: 403 QUEUE_BANNED)
  if (agent.queueBanUntil && agent.queueBanUntil.getTime() > Date.now()) {
    const retryAfter = Math.ceil((agent.queueBanUntil.getTime() - Date.now()) / 1000);
    throw new ApiError(403, "QUEUE_BANNED", `Queue ban active, retry after ${retryAfter}s`, {
      retryAfter,
    });
  }

  // Check durable cooldown (PRD F03: 429 QUEUE_COOLDOWN)
  if (agent.queueCooldownUntil && agent.queueCooldownUntil.getTime() > Date.now()) {
    const retryAfter = Math.ceil((agent.queueCooldownUntil.getTime() - Date.now()) / 1000);
    throw new ApiError(429, "QUEUE_COOLDOWN", `Queue cooldown active, retry after ${retryAfter}s`);
  }

  // Check anti-abuse
  checkAntiAbuse(agentId);

  // Check duplicate (PRD: 409 ALREADY_IN_QUEUE)
  const existingEntry = db.getQueueEntryByAgent(agentId);
  if (existingEntry) {
    throw new ApiError(409, "ALREADY_IN_QUEUE", "Agent is already in the queue");
  }

  const now = new Date();
  const entry: QueueEntry = {
    id: randomUUID(),
    agentId,
    joinedAt: now,
    lastActivityAt: now,
    lastSSEPing: null,
    lastPollTimestamp: now,
    sseDisconnectedAt: null,
    status: "WAITING",
  };

  db.createQueueEntry(entry);
  db.updateAgent({ ...agent, status: AgentStatus.QUEUED, updatedAt: now });
  recordJoinCycle(agentId);

  const position = getPosition(entry);

  // Signal that queue changed — event bus wiring will trigger matchmaker
  emitDomainEvent({ type: "QUEUE_JOINED", matchId: "" });

  return {
    position,
    estimatedWaitSec: position * 30, // rough estimate
    queueId: entry.id,
  };
}

export function leaveQueue(agentId: string): {
  status: string;
  removedAt: string | null;
  reason: string | null;
} {
  const agent = db.getAgent(agentId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found");

  if (agent.status === AgentStatus.IN_MATCH) {
    throw new ApiError(403, "INVALID_STATE", "Cannot leave queue while in a match");
  }

  const entry = db.getQueueEntryByAgent(agentId);
  if (!entry) {
    // PRD F03b: idempotent — already not in queue → 200
    return { status: "NOT_IN_QUEUE", removedAt: null, reason: null };
  }

  const removedAt = new Date();
  db.updateQueueEntry({ ...entry, status: "REMOVED", removedReason: "MANUAL" });

  // Restore previous status
  const newStatus = agent.status === AgentStatus.QUEUED ? AgentStatus.QUALIFIED : agent.status;
  db.updateAgent({ ...agent, status: newStatus, updatedAt: removedAt });

  return { status: "LEFT", removedAt: removedAt.toISOString(), reason: "MANUAL" };
}

function resolveMatchedPayload(agentId: string): {
  matchId: string;
  opponent: { id: string; name: string; elo: number };
  readyDeadline?: string;
} | null {
  const matches = db.listMatches();
  const match = matches.find(
    (m) => (m.agentA === agentId || m.agentB === agentId) && m.currentPhase === "READY_CHECK",
  );
  if (!match) return null;

  const opponentId = match.agentA === agentId ? match.agentB : match.agentA;
  const opponent = db.getAgent(opponentId);
  return {
    matchId: match.id,
    opponent: {
      id: opponentId,
      name: opponent?.name ?? "Unknown",
      elo: opponent?.elo ?? 1500,
    },
    readyDeadline: match.readyDeadline?.toISOString(),
  };
}

export function checkPosition(agentId: string): {
  status: string;
  position?: number;
  estimatedWaitSec?: number;
  matchId?: string;
  opponent?: { id: string; name: string; elo: number };
  readyDeadline?: string;
} {
  const entry = db.getActiveQueueEntryByAgent(agentId);

  // Boundary hardening: if assignment happened but queue row has not atomically reflected it,
  // trust READY_CHECK match assignment and avoid false NOT_IN_QUEUE.
  const agent = db.getAgent(agentId);
  if (!entry) {
    if (agent?.status === AgentStatus.MATCHED) {
      const matched = resolveMatchedPayload(agentId);
      if (matched) {
        return { status: "MATCHED", ...matched };
      }
    }
    return { status: "NOT_IN_QUEUE" };
  }

  // Update heartbeat (explicit poll = lastPollTimestamp)
  const now = new Date();
  entry.lastPollTimestamp = now;
  entry.lastActivityAt = now;
  db.updateQueueEntry(entry);

  if (entry.status === "MATCHED" || agent?.status === AgentStatus.MATCHED) {
    const matched = resolveMatchedPayload(agentId);
    if (matched) {
      return {
        status: "MATCHED",
        ...matched,
      };
    }
  }

  const position = getPosition(entry);
  return {
    status: "QUEUED",
    position,
    estimatedWaitSec: position * 30,
  };
}

function getPosition(entry: QueueEntry): number {
  const waiting = db.listQueueEntries("WAITING");
  const idx = waiting.findIndex((e) => e.id === entry.id);
  return idx >= 0 ? idx + 1 : waiting.length + 1;
}

export function getPublicQueue(): {
  queue: Array<{ position: number; agentId: string; name: string; elo: number; waitingSec: number }>;
  currentMatch: {
    matchId: string;
    agentA: { id: string; name: string; elo: number };
    agentB: { id: string; name: string; elo: number };
    round: number;
    score: string;
    status: string;
  } | null;
  queueLength: number;
} {
  const waiting = db.listQueueEntries("WAITING");
  const nowMs = Date.now();

  const queue = waiting.map((entry, idx) => {
    const agent = db.getAgent(entry.agentId);
    return {
      position: idx + 1,
      agentId: entry.agentId,
      name: agent?.name ?? "Unknown",
      elo: agent?.elo ?? 1500,
      waitingSec: Math.floor((nowMs - entry.joinedAt.getTime()) / 1000),
    };
  });

  // Find current running match
  const allRunning = db.listMatches().filter((m) => m.status.toString() === "RUNNING");
  const runningMatch = allRunning.find((m) => m.id.startsWith("demo-")) ?? allRunning[allRunning.length - 1] ?? null;
  let currentMatch = null;
  if (runningMatch) {
    const agentA = db.getAgent(runningMatch.agentA);
    const agentB = db.getAgent(runningMatch.agentB);
    currentMatch = {
      matchId: runningMatch.id,
      agentA: { id: runningMatch.agentA, name: agentA?.name ?? "Unknown", elo: agentA?.elo ?? 1500 },
      agentB: { id: runningMatch.agentB, name: agentB?.name ?? "Unknown", elo: agentB?.elo ?? 1500 },
      round: runningMatch.currentRound,
      score: `${runningMatch.scoreA}:${runningMatch.scoreB}`,
      status: "RUNNING",
    };
  }

  return {
    queue,
    currentMatch,
    queueLength: queue.length,
  };
}

/** Reset anti-abuse tracking (for testing) */
export function resetQueueService(): void {
  joinCycles.clear();
}
