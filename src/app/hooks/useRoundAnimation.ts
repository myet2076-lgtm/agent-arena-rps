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
  const queueRef = useRef<GameEvent | null>(null);
  const processEventRef = useRef<((evt: GameEvent) => void) | null>(null);

  const clearTimers = useCallback(() => {
    for (const t of timerRefs.current) clearTimeout(t);
    timerRefs.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    timerRefs.current.push(setTimeout(fn, ms));
  }, []);

  const finishAnimation = useCallback(() => {
    animatingRef.current = false;
    setState((prev) => ({ ...prev, phase: "idle" }));
    const queued = queueRef.current;
    queueRef.current = null;
    if (queued && processEventRef.current) {
      setTimeout(() => processEventRef.current!(queued), 50);
    }
  }, []);

  const runRoundSequence = useCallback(
    (evt: GameEvent & { type: "ROUND_RESULT" }) => {
      animatingRef.current = true;
      clearTimers();

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
        schedule(() => finishAnimation(), 600);
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

      let t = DURATIONS["round-announce"]!;

      schedule(() => {
        setState((prev) => ({ ...prev, phase: "choosing" }));
      }, t);
      t += DURATIONS.choosing!;

      schedule(() => {
        setState((prev) => ({
          ...prev,
          phase: "reveal",
          moveA: evt.moveA ?? null,
          moveB: evt.moveB ?? null,
        }));
      }, t);
      t += DURATIONS.reveal!;

      schedule(() => {
        setState((prev) => ({ ...prev, phase: "clash" }));
      }, t);
      t += DURATIONS.clash!;

      schedule(() => {
        setState((prev) => ({
          ...prev,
          phase: "result",
          outcome: evt.outcome,
          winnerId: evt.winner ?? null,
        }));
      }, t);
      t += DURATIONS.result!;

      schedule(() => finishAnimation(), t);
    },
    [clearTimers, schedule, finishAnimation],
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
    (evt: GameEvent) => {
      if (evt.type === "ROUND_RESULT") {
        if (animatingRef.current) {
          queueRef.current = evt;
          clearTimers();
          animatingRef.current = false;
          setState((prev) => ({ ...prev, phase: "idle" }));
          setTimeout(() => {
            const queued = queueRef.current;
            queueRef.current = null;
            if (queued && processEventRef.current) processEventRef.current(queued);
          }, 50);
          return;
        }
        runRoundSequence(evt as GameEvent & { type: "ROUND_RESULT" });
      } else if (evt.type === "MATCH_FINISHED") {
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
