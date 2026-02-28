"use client";

import { useEffect, useRef, useState } from "react";
import type { Match, MatchDTO } from "@/types";
import styles from "./ScoreBoard.module.css";

interface ScoreBoardProps {
  match: Match | MatchDTO;
}

function eloFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 250;
  return 1450 + hash;
}

/** Animated score that ticks up/down to target */
function useAnimatedScore(target: number): { display: number; bumping: boolean } {
  const [display, setDisplay] = useState(target);
  const [bumping, setBumping] = useState(false);
  const prevRef = useRef(target);

  useEffect(() => {
    if (target === prevRef.current) return;
    prevRef.current = target;
    setBumping(true);
    setDisplay(target);
    const t = setTimeout(() => setBumping(false), 400);
    return () => clearTimeout(t);
  }, [target]);

  return { display, bumping };
}

export function ScoreBoard({ match }: ScoreBoardProps) {
  const leader = match.scoreA === match.scoreB ? "TIE" : match.scoreA > match.scoreB ? "A" : "B";
  const winnerSide = match.winnerId ? (match.winnerId === match.agentA ? "A" : "B") : null;
  const total = match.scoreA + match.scoreB;
  const pctA = total === 0 ? 50 : Math.round((match.scoreA / total) * 100);
  const pctB = total === 0 ? 50 : 100 - pctA;

  const scoreA = useAnimatedScore(match.scoreA);
  const scoreB = useAnimatedScore(match.scoreB);

  return (
    <section className={styles.wrap}>
      <div className={`${styles.side} ${styles.left}`}>
        <div className={styles.headline}>🤖 {match.agentA}</div>
        <div className={`${styles.score} ${leader === "A" ? styles.pulseCyan : ""} ${scoreA.bumping ? styles.scoreBump : ""}`}>
          {scoreA.display}
        </div>
        <div className={styles.hpBar}>
          <div className={`${styles.hpFill} ${styles.hpFillA}`} style={{ width: `${pctA}%` }} />
        </div>
        <div className={styles.meta}>Wins: {match.winsA}</div>
        <div className={styles.meta}>ELO {eloFromId(match.agentA)}</div>
        {winnerSide === "A" && <div className={styles.crown}>👑 WINNER</div>}
      </div>

      <div className={styles.center}>
        <div className={styles.vs}>VS</div>
        <div className={styles.format}>{match.format}</div>
      </div>

      <div className={`${styles.side} ${styles.right}`}>
        <div className={styles.headline}>🤖 {match.agentB}</div>
        <div className={`${styles.score} ${leader === "B" ? styles.pulseMagenta : ""} ${scoreB.bumping ? styles.scoreBump : ""}`}>
          {scoreB.display}
        </div>
        <div className={styles.hpBar}>
          <div className={`${styles.hpFill} ${styles.hpFillB}`} style={{ width: `${pctB}%` }} />
        </div>
        <div className={styles.meta}>Wins: {match.winsB}</div>
        <div className={styles.meta}>ELO {eloFromId(match.agentB)}</div>
        {winnerSide === "B" && <div className={styles.crown}>👑 WINNER</div>}
      </div>
    </section>
  );
}
