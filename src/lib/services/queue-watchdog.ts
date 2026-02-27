/**
 * Queue Watchdog (PRD §3.2, F03)
 * Removes stale queue entries that haven't heartbeated.
 * Uses max(lastSSEPing, lastPollTimestamp) as effective last activity.
 * 10s grace period after SSE disconnect.
 */

import { db } from "@/lib/server/in-memory-db";
import { AgentStatus } from "@/types";
import { QUEUE_HEARTBEAT_SEC } from "@/lib/config/timing";
import { emitQueueEvent, type QueueEvent } from "./queue-events";

const SSE_DISCONNECT_GRACE_MS = 10_000; // 10s grace after SSE disconnect
let watchdogInterval: ReturnType<typeof setInterval> | null = null;

export function runWatchdogCheck(): QueueEvent[] {
  const now = Date.now();
  const waiting = db.listQueueEntries("WAITING");
  const events: QueueEvent[] = [];

  for (const entry of waiting) {
    // Effective last activity = max(lastSSEPing, lastPollTimestamp)
    const ssePing = entry.lastSSEPing?.getTime() ?? 0;
    const pollTime = entry.lastPollTimestamp?.getTime() ?? 0;
    const effectiveLastActivity = Math.max(ssePing, pollTime, entry.lastActivityAt.getTime());

    const elapsed = now - effectiveLastActivity;

    // Check SSE disconnect grace period
    if (entry.sseDisconnectedAt) {
      const gracePassed = now - entry.sseDisconnectedAt.getTime() > SSE_DISCONNECT_GRACE_MS;
      if (!gracePassed) continue; // Still in grace period
    }

    if (elapsed > QUEUE_HEARTBEAT_SEC * 1000) {
      // Remove stale entry
      db.updateQueueEntry({ ...entry, status: "REMOVED", removedReason: "TIMEOUT" });

      const agent = db.getAgent(entry.agentId);
      if (agent && agent.status === AgentStatus.QUEUED) {
        db.updateAgent({ ...agent, status: AgentStatus.QUALIFIED, updatedAt: new Date() });
      }

      const event: QueueEvent = { type: "REMOVED", agentId: entry.agentId, reason: "TIMEOUT" };
      emitQueueEvent(entry.agentId, event);
      events.push(event);
    }
  }

  return events;
}

export function startWatchdog(): void {
  if (watchdogInterval) return;
  watchdogInterval = setInterval(runWatchdogCheck, 10_000);
}

export function stopWatchdog(): void {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
}
