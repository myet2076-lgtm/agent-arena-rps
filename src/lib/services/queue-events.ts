/**
 * Queue Event Bus — simple pub/sub for queue SSE
 */

export type QueueEvent =
  | { type: "POSITION_UPDATE"; agentId: string; position: number }
  | { type: "MATCH_ASSIGNED"; agentId: string; matchId: string; opponentId: string }
  | { type: "REMOVED"; agentId: string; reason: "TIMEOUT" | "BANNED" | "MATCHED" | "MANUAL" };

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
