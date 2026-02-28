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

export function ScoreBoard({ match }: ScoreBoardProps) {
  const leader = match.scoreA === match.scoreB ? "TIE" : match.scoreA > match.scoreB ? "A" : "B";
  const winnerSide = match.winnerId ? (match.winnerId === match.agentA ? "A" : "B") : null;
  const total = match.scoreA + match.scoreB;
  const pctA = total === 0 ? 50 : Math.round((match.scoreA / total) * 100);
  const pctB = total === 0 ? 50 : Math.round((match.scoreB / total) * 100);

  return (
    <section className={styles.wrap}>
      <div className={`${styles.side} ${styles.left}`}>
        <div className={styles.headline}>🤖 {match.agentA}</div>
        <div className={`${styles.score} ${leader === "A" ? styles.pulseCyan : ""}`}>{match.scoreA}</div>
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
        <div className={`${styles.score} ${leader === "B" ? styles.pulseMagenta : ""}`}>{match.scoreB}</div>
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
