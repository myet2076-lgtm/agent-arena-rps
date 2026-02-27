/**
 * Domain Event Bus (PRD §7.2)
 * Simple pub/sub for match lifecycle events.
 */

import { EventEmitter } from "node:events";

export type DomainEventType = "MATCH_FINISHED" | "QUEUE_EXPIRED" | "READY_TIMEOUT" | "ROUND_RESULT";

export interface DomainEvent {
  type: DomainEventType;
  matchId: string;
  payload?: Record<string, unknown>;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function emitDomainEvent(event: DomainEvent): void {
  emitter.emit(event.type, event);
  emitter.emit("*", event);
}

export function onDomainEvent(type: DomainEventType | "*", handler: (event: DomainEvent) => void): () => void {
  emitter.on(type, handler);
  return () => emitter.off(type, handler);
}

export function resetEventBus(): void {
  emitter.removeAllListeners();
}
