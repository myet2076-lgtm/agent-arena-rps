import { Move, type RoundDTO, RoundOutcome } from "@/types";
import styles from "./RoundTimeline.module.css";

interface RoundTimelineProps {
  rounds: RoundDTO[];
}

const moveMap: Record<Move, string> = {
  [Move.ROCK]: "✊",
  [Move.PAPER]: "✋",
  [Move.SCISSORS]: "✌️",
};

function outcomeLabel(outcome: RoundOutcome | null): string {
  if (!outcome) return "Pending";
  if (outcome === RoundOutcome.WIN_A) return "Agent A wins";
  if (outcome === RoundOutcome.WIN_B) return "Agent B wins";
  if (outcome === RoundOutcome.DRAW) return "Draw";
  if (outcome === RoundOutcome.FORFEIT_A) return "A forfeits";
  return "B forfeits";
}

export function RoundTimeline({ rounds }: RoundTimelineProps) {
  const ordered = rounds.slice().sort((a, b) => a.roundNo - b.roundNo);

  if (ordered.length === 0) {
    return <section className={styles.empty}>No rounds completed yet. Live updates will appear here.</section>;
  }

  return (
    <section className={styles.timeline}>
      {ordered.map((round, idx) => {
        const winnerClass =
          round.outcome === RoundOutcome.WIN_A || round.outcome === RoundOutcome.FORFEIT_B
            ? styles.aWin
            : round.outcome === RoundOutcome.WIN_B || round.outcome === RoundOutcome.FORFEIT_A
              ? styles.bWin
              : styles.draw;

        return (
          <article
            key={round.id}
            className={`${styles.row} ${winnerClass} ${round.readBonusA || round.readBonusB ? styles.readBonus : ""}`}
            style={{ animationDelay: `${Math.min(idx * 60, 500)}ms` }}
          >
            <div className={styles.roundNo}>R{round.roundNo}</div>
            <div className={styles.content}>
              <div className={styles.moves}>
                <span>{round.moveA ? moveMap[round.moveA] : "?"}</span>
                <span className={styles.versus}>vs</span>
                <span>{round.moveB ? moveMap[round.moveB] : "?"}</span>
              </div>

              <div className={styles.outcome}>{outcomeLabel(round.outcome)}</div>
              <div className={styles.points}>+{round.pointsA} / +{round.pointsB} points</div>

              {(round.readBonusA || round.readBonusB) && (
                <div className={styles.flag}>⚡ Read bonus: {round.readBonusA ? "A" : "B"}</div>
              )}

              {(round.violationA || round.violationB) && (
                <div className={styles.flag}>⚠️ Violation: {round.violationA ?? round.violationB}</div>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
