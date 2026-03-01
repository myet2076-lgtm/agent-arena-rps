"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Move, RoundOutcome, type GameEvent } from "@/types";

const MOVES = [Move.ROCK, Move.PAPER, Move.SCISSORS];
const DEMO_PAIRS = [
  { a: "RyuBot", b: "KenBot" },
  { a: "AkumaAI", b: "ChunLiAI" },
  { a: "TerryBot", b: "IoriBot" },
];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rpsOutcome(a: Move, b: Move): RoundOutcome {
  if (a === b) return RoundOutcome.DRAW;
  if (
    (a === Move.ROCK && b === Move.SCISSORS) ||
    (a === Move.PAPER && b === Move.ROCK) ||
    (a === Move.SCISSORS && b === Move.PAPER)
  ) return RoundOutcome.WIN_A;
  return RoundOutcome.WIN_B;
}

interface DemoMatch {
  id: string;
  agentA: string;
  agentB: string;
  agentAName: string;
  agentBName: string;
  scoreA: number;
  scoreB: number;
  status: string;
  bestOf: number;
  currentRound: number;
  rounds: Array<{
    round: number;
    moveA: Move | null;
    moveB: Move | null;
    outcome: RoundOutcome | null;
    pointsA: number;
    pointsB: number;
  }>;
}

interface UseClientDemoResult {
  match: DemoMatch | null;
  events: GameEvent[];
  latestEvent: GameEvent | null;
}

export function useClientDemo(enabled: boolean): UseClientDemoResult {
  const [match, setMatch] = useState<DemoMatch | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<GameEvent | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  const startMatch = useCallback(() => {
    const pair = rand(DEMO_PAIRS);
    const id = `demo-client-${Date.now()}`;
    const m: DemoMatch = {
      id,
      agentA: `demo-${pair.a.toLowerCase()}`,
      agentB: `demo-${pair.b.toLowerCase()}`,
      agentAName: pair.a,
      agentBName: pair.b,
      scoreA: 0,
      scoreB: 0,
      status: "RUNNING",
      bestOf: 7,
      currentRound: 0,
      rounds: [],
    };
    setMatch(m);
    setEvents([]);
    setLatestEvent(null);
    return m;
  }, []);

  const playRound = useCallback((m: DemoMatch): DemoMatch => {
    const roundNo = m.currentRound + 1;
    const moveA = rand(MOVES);
    const moveB = rand(MOVES);
    const outcome = rpsOutcome(moveA, moveB);
    const pointsA = outcome === RoundOutcome.WIN_A ? 1 : 0;
    const pointsB = outcome === RoundOutcome.WIN_B ? 1 : 0;
    const scoreA = m.scoreA + pointsA;
    const scoreB = m.scoreB + pointsB;

    const round = { round: roundNo, moveA, moveB, outcome, pointsA, pointsB };
    const updated = {
      ...m,
      scoreA,
      scoreB,
      currentRound: roundNo,
      rounds: [...m.rounds, round],
    };

    const evt: GameEvent = {
      type: "ROUND_RESULT",
      matchId: m.id,
      roundNo,
      outcome,
      pointsA,
      pointsB,
      predictionBonusA: false,
      predictionBonusB: false,
      scoreA,
      scoreB,
      moveA,
      moveB,
      winner: outcome === RoundOutcome.WIN_A ? m.agentA : outcome === RoundOutcome.WIN_B ? m.agentB : null,
    };

    setMatch(updated);
    setEvents(prev => [...prev, evt]);
    setLatestEvent(evt);

    const winsNeeded = Math.ceil(m.bestOf / 2);
    if (scoreA >= winsNeeded || scoreB >= winsNeeded) {
      const finishEvt: GameEvent = {
        type: "MATCH_FINISHED",
        matchId: m.id,
        winnerId: scoreA > scoreB ? m.agentA : m.agentB,
        winnerName: scoreA > scoreB ? m.agentAName : m.agentBName,
        finalScoreA: scoreA,
        finalScoreB: scoreB,
      };
      setTimeout(() => {
        setEvents(prev => [...prev, finishEvt]);
        setLatestEvent(finishEvt);
        setMatch(prev => prev ? { ...prev, status: "FINISHED" } : null);
      }, 2000);
    }

    return updated;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    runningRef.current = true;

    const runLoop = async () => {
      while (runningRef.current) {
        let m = startMatch();
        // Wait before first round
        await new Promise(r => { timerRef.current = setTimeout(r, 2000); });
        
        const winsNeeded = Math.ceil(m.bestOf / 2);
        while (runningRef.current && m.scoreA < winsNeeded && m.scoreB < winsNeeded) {
          m = playRound(m);
          // Wait between rounds
          await new Promise(r => { timerRef.current = setTimeout(r, 3500); });
        }
        
        // Wait before next match
        if (runningRef.current) {
          await new Promise(r => { timerRef.current = setTimeout(r, 6000); });
        }
      }
    };

    runLoop();

    return () => {
      runningRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, startMatch, playRound]);

  return { match, events, latestEvent };
}
