"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RoundOutcome, type GameEvent } from "@/types";

interface UseMatchSSEResult {
  events: GameEvent[];
  latestEvent: GameEvent | null;
  connected: boolean;
}

const MAX_EVENTS = 200;

/**
 * Normalize a raw SSE payload into the canonical GameEvent shape.
 *
 * The backend viewer perspective emits ROUND_RESULT with:
 *   { round, winner, scoreA, scoreB, moveA, moveB, predictionBonusA/B }
 * but the frontend expects:
 *   { roundNo, outcome, pointsA, pointsB, scoreA, scoreB, moveA, moveB, ... }
 *
 * This adapter bridges the contract without changing the backend API.
 */
function normalizeEvent(raw: Record<string, unknown>): GameEvent {
  const type = raw.type as string;

  if (type === "ROUND_RESULT") {
    // Map `round` -> `roundNo` (backend sends `round`, frontend expects `roundNo`)
    const roundNo = (raw.roundNo ?? raw.round ?? 0) as number;

    // Derive outcome from `winner` field if `outcome` is missing
    let outcome = raw.outcome as RoundOutcome | undefined;
    if (!outcome && raw.winner !== undefined) {
      const winner = raw.winner as string | null;
      if (winner === "A" || winner === "agentA") {
        outcome = RoundOutcome.WIN_A;
      } else if (winner === "B" || winner === "agentB") {
        outcome = RoundOutcome.WIN_B;
      } else if (winner === null || winner === "draw" || winner === "DRAW") {
        outcome = RoundOutcome.DRAW;
      }
    }
    outcome = outcome ?? RoundOutcome.DRAW;

    // Map pointsA/B - backend may not send them; derive from outcome
    let pointsA = raw.pointsA as number | undefined;
    let pointsB = raw.pointsB as number | undefined;
    if (pointsA === undefined || pointsB === undefined) {
      if (outcome === RoundOutcome.WIN_A) {
        pointsA = pointsA ?? ((raw.predictionBonusA as boolean) ? 2 : 1);
        pointsB = pointsB ?? 0;
      } else if (outcome === RoundOutcome.WIN_B) {
        pointsA = pointsA ?? 0;
        pointsB = pointsB ?? ((raw.predictionBonusB as boolean) ? 2 : 1);
      } else {
        pointsA = pointsA ?? 0;
        pointsB = pointsB ?? 0;
      }
    }

    return {
      type: "ROUND_RESULT",
      matchId: raw.matchId as string,
      roundNo,
      outcome,
      pointsA,
      pointsB,
      predictionBonusA: (raw.predictionBonusA ?? false) as boolean,
      predictionBonusB: (raw.predictionBonusB ?? false) as boolean,
      scoreA: (raw.scoreA ?? 0) as number,
      scoreB: (raw.scoreB ?? 0) as number,
      moveA: (raw.moveA ?? null) as GameEvent & { type: "ROUND_RESULT" } extends { moveA: infer M } ? M : never,
      moveB: (raw.moveB ?? null) as GameEvent & { type: "ROUND_RESULT" } extends { moveB: infer M } ? M : never,
      winner: (raw.winner ?? null) as string | null | undefined,
    };
  }

  if (type === "MATCH_FINISHED") {
    return {
      type: "MATCH_FINISHED",
      matchId: raw.matchId as string,
      winnerId: (raw.winnerId ?? raw.winner ?? null) as string | null,
      finalScoreA: (raw.finalScoreA ?? raw.scoreA ?? 0) as number,
      finalScoreB: (raw.finalScoreB ?? raw.scoreB ?? 0) as number,
      eloChangeA: (raw.eloChangeA ?? null) as number | null | undefined,
      eloChangeB: (raw.eloChangeB ?? null) as number | null | undefined,
    };
  }

  // All other event types: pass through as-is
  return raw as unknown as GameEvent;
}

export function useMatchSSE(matchId: string | null): UseMatchSSEResult {
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<GameEvent | null>(null);
  const [connected, setConnected] = useState(false);

  const retriesRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const matchIdRef = useRef<string | null>(null);

  // Fix #3: Reset state when matchId changes
  useEffect(() => {
    if (matchId !== matchIdRef.current) {
      matchIdRef.current = matchId;
      setEvents([]);
      setLatestEvent(null);
      setConnected(false);
    }
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;

    let cancelled = false;

    const clearReconnect = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const cleanupSource = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      clearReconnect();
      const backoff = Math.min(1000 * 2 ** retriesRef.current, 15000);
      reconnectTimerRef.current = window.setTimeout(() => {
        connect();
      }, backoff);
      retriesRef.current += 1;
    };

    const onEventMessage = (raw: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(raw.data) as Record<string, unknown>;
        const normalized = normalizeEvent(parsed);
        setLatestEvent(normalized);
        setEvents((prev) => {
          const next = [...prev, normalized];
          return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
        });
      } catch {
        // Ignore malformed keepalive/misc payloads
      }
    };

    /** Handler for events the frontend logs but does not visually act on */
    const onInfoEvent = (raw: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(raw.data) as Record<string, unknown>;
        if (process.env.NODE_ENV === "development") {
          console.debug("[SSE]", parsed.type, parsed);
        }
      } catch {
        // ignore
      }
    };

    /** Handler for RESYNC / STATE_SNAPSHOT - trigger match data refresh */
    const onResyncEvent = (raw: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(raw.data) as Record<string, unknown>;
        if (process.env.NODE_ENV === "development") {
          console.debug("[SSE] resync/snapshot", parsed);
        }
        const normalized = normalizeEvent(parsed);
        setLatestEvent(normalized);
        setEvents((prev) => {
          const next = [...prev, normalized];
          return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
        });
      } catch {
        // ignore
      }
    };

    const connect = () => {
      if (cancelled) return;

      cleanupSource();
      const source = new EventSource(`/api/matches/${matchId}/events`);
      eventSourceRef.current = source;

      source.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        retriesRef.current = 0;
      };

      source.onmessage = onEventMessage;

      // Core events the frontend actively renders
      const activeEventTypes: Array<GameEvent["type"]> = [
        "MATCH_STARTED",
        "ROUND_COMMIT",
        "ROUND_RESULT",
        "MATCH_FINISHED",
        "MARKET_UPDATE",
        "VOTE_UPDATE",
      ];

      for (const eventType of activeEventTypes) {
        source.addEventListener(eventType, onEventMessage as EventListener);
      }

      // Fix #2: Additional event listeners for backend-emitted events
      // Logged/acknowledged but don't drive visual state
      const infoEventTypes = [
        "MATCH_START",
        "ROUND_START",
        "BOTH_COMMITTED",
        "READY_TIMEOUT",
      ];

      for (const eventType of infoEventTypes) {
        source.addEventListener(eventType, onInfoEvent as EventListener);
      }

      // RESYNC and STATE_SNAPSHOT trigger a data refresh
      source.addEventListener("RESYNC", onResyncEvent as EventListener);
      source.addEventListener("STATE_SNAPSHOT", onResyncEvent as EventListener);

      source.onerror = () => {
        if (cancelled) return;
        setConnected(false);
        cleanupSource();
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      cancelled = true;
      setConnected(false);
      clearReconnect();
      cleanupSource();
    };
  }, [matchId]);

  return { events, latestEvent, connected };
}
