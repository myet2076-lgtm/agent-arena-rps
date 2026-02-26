"use client";

import { useEffect, useRef, useState } from "react";
import type { GameEvent } from "@/types";

interface UseMatchSSEResult {
  events: GameEvent[];
  latestEvent: GameEvent | null;
  connected: boolean;
}

const MAX_EVENTS = 200;

export function useMatchSSE(matchId: string | null): UseMatchSSEResult {
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<GameEvent | null>(null);
  const [connected, setConnected] = useState(false);

  const retriesRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

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
        const parsed = JSON.parse(raw.data) as GameEvent;
        setLatestEvent(parsed);
        setEvents((prev) => {
          const next = [...prev, parsed];
          return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
        });
      } catch {
        // Ignore malformed keepalive/misc payloads
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

      const eventTypes: Array<GameEvent["type"]> = [
        "MATCH_STARTED",
        "ROUND_COMMIT",
        "ROUND_RESULT",
        "MATCH_FINISHED",
        "MARKET_UPDATE",
        "VOTE_UPDATE",
      ];

      for (const eventType of eventTypes) {
        source.addEventListener(eventType, onEventMessage as EventListener);
      }

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
