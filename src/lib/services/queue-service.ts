/**
 * Queue Service (PRD §3.2)
 * Join, leave, heartbeat, anti-abuse
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/in-memory-db";
import { ApiError } from "@/lib/server/api-error";
import { AgentStatus, type QueueEntry } from "@/types";

const ANTI_ABUSE_WINDOW_MS = 5 * 60_000; // 5 minutes
const ANTI_ABUSE_MAX_CYCLES = 3;
const ANTI_ABUSE_COOLDOWN_MS = 5 * 60_000; // 5 min cooldown

// Track join/leave cycles per agent: agentId -> timestamps of joins
const joinCycles = new Map<string, number[]>();

function checkAntiAbuse(agentId: string): void {
  const now = Date.now();
  const cycles = (joinCycles.get(agentId) ?? []).filter((t) => now - t < ANTI_ABUSE_WINDOW_MS);
  if (cycles.length >= ANTI_ABUSE_MAX_CYCLES) {
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
    throw new ApiError(403, "INVALID_STATE", `Agent status is ${agent.status}, must be QUALIFIED or POST_MATCH`);
  }

  // Check anti-abuse
  checkAntiAbuse(agentId);

  const now = new Date();
  const entry: QueueEntry = {
    id: randomUUID(),
    agentId,
    joinedAt: now,
    lastActivityAt: now,
    status: "WAITING",
  };

  db.createQueueEntry(entry);
  db.updateAgent({ ...agent, status: AgentStatus.QUEUED, updatedAt: now });
  recordJoinCycle(agentId);

  const position = getPosition(entry);
  return {
    position,
    estimatedWaitSec: position * 30, // rough estimate
    queueId: entry.id,
  };
}

export function leaveQueue(agentId: string): { status: string } {
  const agent = db.getAgent(agentId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found");

  if (agent.status === AgentStatus.IN_MATCH) {
    throw new ApiError(403, "INVALID_STATE", "Cannot leave queue while in a match");
  }

  const entry = db.getQueueEntryByAgent(agentId);
  if (!entry) {
    // Idempotent: already not in queue
    return { status: "LEFT" };
  }

  db.updateQueueEntry({ ...entry, status: "REMOVED", removedReason: "MANUAL" });

  // Restore previous status
  const newStatus = agent.status === AgentStatus.QUEUED ? AgentStatus.QUALIFIED : agent.status;
  db.updateAgent({ ...agent, status: newStatus, updatedAt: new Date() });

  return { status: "LEFT" };
}

export function checkPosition(agentId: string): {
  position: number;
  estimatedWaitSec: number;
  joinedAt: Date;
} {
  const entry = db.getQueueEntryByAgent(agentId);
  if (!entry) throw new ApiError(404, "NOT_IN_QUEUE", "Agent is not in queue");

  // Update heartbeat
  entry.lastActivityAt = new Date();
  db.updateQueueEntry(entry);

  const position = getPosition(entry);
  return {
    position,
    estimatedWaitSec: position * 30,
    joinedAt: entry.joinedAt,
  };
}

function getPosition(entry: QueueEntry): number {
  const waiting = db.listQueueEntries("WAITING");
  const idx = waiting.findIndex((e) => e.id === entry.id);
  return idx >= 0 ? idx + 1 : waiting.length + 1;
}

export function getPublicQueue(): {
  queue: Array<{ position: number; agentId: string; agentName: string; elo: number; waitingSec: number }>;
  total: number;
  estimatedMatchSec: number;
} {
  const waiting = db.listQueueEntries("WAITING");
  const now = Date.now();

  const queue = waiting.map((entry, idx) => {
    const agent = db.getAgent(entry.agentId);
    return {
      position: idx + 1,
      agentId: entry.agentId,
      agentName: agent?.name ?? "Unknown",
      elo: agent?.elo ?? 1500,
      waitingSec: Math.floor((now - entry.joinedAt.getTime()) / 1000),
    };
  });

  return {
    queue,
    total: queue.length,
    estimatedMatchSec: queue.length > 1 ? 30 : 60,
  };
}

/** Reset anti-abuse tracking (for testing) */
export function resetQueueService(): void {
  joinCycles.clear();
}
