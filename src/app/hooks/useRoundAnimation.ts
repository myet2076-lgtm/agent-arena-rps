"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Move, RoundOutcome, type GameEvent } from "@/types";

export type AnimationPhase =
  | "idle"
  | "round-announce"
  | "choosing"
  | "reveal"
  | "clash"
  | "result"
  | "match-end";

export interface RoundAnimationState {
  phase: AnimationPhase;
  roundNo: number;
  moveA: Move | null;
  moveB: Move | null;
  outcome: RoundOutcome | null;
  winnerId: string | null;
  winnerName: string | null;
}

const INITIAL_STATE: RoundAnimationState = {
  phase: "idle",
  roundNo: 0,
  moveA: null,
  moveB: null,
  outcome: null,
  winnerId: null,
  winnerName: null,
};

/* Phase durations in ms */
const DURATIONS: Partial<Record<AnimationPhase, number>> = {
  "round-announce": 800,
  choosing: 1500,
  reveal: 1000,
  clash: 1000,
  result: 1500,
  "match-end": 4000,
};

/* Shorter durations when draining a backlog */
const FAST_DURATIONS: Partial<Record<AnimationPhase, number>> = {
  "round-announce": 300,
  choosing: 400,
  reveal: 300,
  clash: 400,
  result: 500,
  "match-end": 4000,
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useRoundAnimation(
  latestEvent: GameEvent | null,
  agentA: string | null,
  agentB: string | null,
): RoundAnimationState {
  const [state, setState] = useState<RoundAnimationState>(INITIAL_STATE);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const animatingRef = useRef(false);
  /* Fix #3: queue is now an array instead of single ref */
  const queueRef = useRef<GameEvent[]>([]);
  const processEventRef = useRef<((evt: GameEvent, fastHint?: boolean) => void) | null>(null);

  const clearTimers = useCallback(() => {
    for (const t of timerRefs.current) clearTimeout(t);
    timerRefs.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    timerRefs.current.push(setTimeout(fn, ms));
  }, []);

  const drainNext = useCallback(() => {
    animatingRef.current = false;
    setState((prev) => ({ ...prev, phase: "idle" }));
    const fast = queueRef.current.length > 1; // more events waiting after this one
    const next = queueRef.current.shift();
    if (next && processEventRef.current) {
      const id = setTimeout(() => processEventRef.current!(next, fast), 50);
      timerRefs.current.push(id);
    }
  }, []);

  const runRoundSequence = useCallback(
    (evt: GameEvent & { type: "ROUND_RESULT" }, fast: boolean) => {
      animatingRef.current = true;
      clearTimers();

      const dur = fast ? FAST_DURATIONS : DURATIONS;

      if (prefersReducedMotion()) {
        setState({
          phase: "result",
          roundNo: evt.roundNo,
          moveA: evt.moveA ?? null,
          moveB: evt.moveB ?? null,
          outcome: evt.outcome,
          winnerId: evt.winner ?? null,
          winnerName: null,
        });
        schedule(() => drainNext(), fast ? 200 : 600);
        return;
      }

      setState({
        phase: "round-announce",
        roundNo: evt.roundNo,
        moveA: null,
        moveB: null,
        outcome: null,
        winnerId: null,
        winnerName: null,
      });

      let t = dur["round-announce"]!;

      schedule(() => {
        setState((prev) => ({ ...prev, phase: "choosing" }));
      }, t);
      t += dur.choosing!;

      schedule(() => {
        setState((prev) => ({
          ...prev,
          phase: "reveal",
          moveA: evt.moveA ?? null,
          moveB: evt.moveB ?? null,
        }));
      }, t);
      t += dur.reveal!;

      schedule(() => {
        setState((prev) => ({ ...prev, phase: "clash" }));
      }, t);
      t += dur.clash!;

      schedule(() => {
        setState((prev) => ({
          ...prev,
          phase: "result",
          outcome: evt.outcome,
          winnerId: evt.winner ?? null,
        }));
      }, t);
      t += dur.result!;

      schedule(() => drainNext(), t);
    },
    [clearTimers, schedule, drainNext],
  );

  const runMatchEnd = useCallback(
    (evt: GameEvent & { type: "MATCH_FINISHED" }) => {
      animatingRef.current = true;
      clearTimers();
      const winnerName =
        evt.winnerId === agentA ? agentA : evt.winnerId === agentB ? agentB : null;

      setState({
        phase: "match-end",
        roundNo: 0,
        moveA: null,
        moveB: null,
        outcome: null,
        winnerId: evt.winnerId,
        winnerName,
      });

      const duration = prefersReducedMotion() ? 1500 : DURATIONS["match-end"]!;
      schedule(() => {
        animatingRef.current = false;
        setState(INITIAL_STATE);
      }, duration);
    },
    [agentA, agentB, clearTimers, schedule],
  );

  const processEvent = useCallback(
    (evt: GameEvent, fastHint?: boolean) => {
      if (evt.type === "ROUND_RESULT") {
        if (animatingRef.current) {
          /* Fix #3: push to queue array instead of overwriting */
          queueRef.current.push(evt);
          return;
        }
        const fast = fastHint ?? queueRef.current.length > 0;
        runRoundSequence(evt as GameEvent & { type: "ROUND_RESULT" }, fast);
      } else if (evt.type === "MATCH_FINISHED") {
        /* Match end takes priority: clear queue and play immediately */
        queueRef.current = [];
        clearTimers();
        animatingRef.current = false;
        runMatchEnd(evt as GameEvent & { type: "MATCH_FINISHED" });
      }
    },
    [clearTimers, runRoundSequence, runMatchEnd],
  );

  processEventRef.current = processEvent;

  useEffect(() => {
    if (!latestEvent) return;
    processEvent(latestEvent);
  }, [latestEvent, processEvent]);

  useEffect(() => {
    return () => { clearTimers(); };
  }, [clearTimers]);

  return state;
}
