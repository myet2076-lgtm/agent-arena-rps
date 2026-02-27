/**
 * Queue Watchdog (PRD §3.2)
 * Removes stale queue entries that haven't heartbeated
 */

import { db } from "@/lib/server/in-memory-db";
import { AgentStatus } from "@/types";
import { QUEUE_HEARTBEAT_SEC } from "@/lib/config/timing";
import { emitQueueEvent, type QueueEvent } from "./queue-events";

const GRACE_PERIOD_MS = 10_000; // 10s grace after disconnect
let watchdogInterval: ReturnType<typeof setInterval> | null = null;

export function runWatchdogCheck(): QueueEvent[] {
  const now = Date.now();
  const waiting = db.listQueueEntries("WAITING");
  const events: QueueEvent[] = [];

  for (const entry of waiting) {
    const lastActivity = entry.lastActivityAt.getTime();
    const elapsed = now - lastActivity;

    if (elapsed > (QUEUE_HEARTBEAT_SEC * 1000) + GRACE_PERIOD_MS) {
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
