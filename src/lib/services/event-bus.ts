/**
 * Domain Event Bus (PRD §7.2)
 * Simple pub/sub for match lifecycle events.
 */

import { EventEmitter } from "node:events";

export type DomainEventType = "MATCH_FINISHED" | "QUEUE_EXPIRED" | "READY_TIMEOUT" | "ROUND_RESULT" | "QUEUE_JOINED";

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
  _wired = false;
}

// ─── Auto-wire: MATCH_FINISHED → re-check queue ────────
let _wired = false;
export function ensureOrchestrationWired(): void {
  if (_wired) return;
  _wired = true;
  const handler = () => {
    // Lazy import to avoid circular deps
    import("./matchmaker").then(({ tryMatch }) => tryMatch()).catch(() => {});
  };
  onDomainEvent("MATCH_FINISHED", handler);
  onDomainEvent("QUEUE_JOINED", handler);
}

// Wire on first import
ensureOrchestrationWired();
