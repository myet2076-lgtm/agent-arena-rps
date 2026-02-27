/**
 * Queue Event Bus — simple pub/sub for queue SSE
 */

export type QueueEvent =
  | { type: "POSITION_UPDATE"; agentId: string; position: number; estimatedWaitSec: number }
  | { type: "MATCH_ASSIGNED"; agentId: string; matchId: string; opponent: { id: string; name: string; elo: number }; readyDeadline: string }
  | { type: "REMOVED"; agentId: string; reason: "TIMEOUT" | "BANNED" | "MATCHED" | "MANUAL" };

export type QueueSsePayload =
  | { position: number; estimatedWaitSec: number }
  | { matchId: string; opponent: { id: string; name: string; elo: number }; readyDeadline: string }
  | { reason: "TIMEOUT" | "BANNED" | "MATCHED" | "MANUAL" };

export function toQueueSsePayload(event: QueueEvent): QueueSsePayload {
  switch (event.type) {
    case "POSITION_UPDATE":
      return {
        position: event.position,
        estimatedWaitSec: event.estimatedWaitSec,
      };
    case "MATCH_ASSIGNED":
      return {
        matchId: event.matchId,
        opponent: event.opponent,
        readyDeadline: event.readyDeadline,
      };
    case "REMOVED":
      return { reason: event.reason };
  }
}

type Listener = (event: QueueEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeQueueEvents(agentId: string, listener: Listener): () => void {
  const set = listeners.get(agentId) ?? new Set();
  set.add(listener);
  listeners.set(agentId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(agentId);
  };
}

export function emitQueueEvent(agentId: string, event: QueueEvent): void {
  const set = listeners.get(agentId);
  if (set) {
    for (const listener of set) listener(event);
  }
}

export function resetQueueEvents(): void {
  listeners.clear();
}
