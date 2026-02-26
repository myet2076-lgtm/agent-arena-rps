import type { HighlightRound, MatchSummary } from "@/types";
import styles from "./HighlightsPanel.module.css";

interface HighlightsPanelProps {
  summary: MatchSummary;
  highlights: HighlightRound[];
}

function typeClass(type: HighlightRound["type"]): string {
  if (type === "CLUTCH") return styles.clutch;
  if (type === "MATCH_POINT") return styles.matchPoint;
  if (type === "REVERSAL") return styles.reversal;
  return styles.readBonus;
}

export function HighlightsPanel({ summary, highlights }: HighlightsPanelProps) {
  const sorted = highlights.slice().sort((a, b) => b.dramaScore - a.dramaScore || a.roundNo - b.roundNo);

  return (
    <section className={styles.panel}>
      <h3>Highlights</h3>

      <div className={styles.stats}>
        <div><span>Rounds</span><strong>{summary.roundsPlayed}</strong></div>
        <div><span>Read bonuses</span><strong>{summary.readBonusCount}</strong></div>
        <div><span>Momentum swings</span><strong>{summary.momentumSwings}</strong></div>
        <div><span>Biggest comeback</span><strong>{summary.largestComeback}</strong></div>
      </div>

      <div className={styles.list}>
        {sorted.map((item) => (
          <article key={`${item.type}-${item.roundNo}-${item.dramaScore}`} className={styles.item}>
            <div className={styles.round}>Round {item.roundNo}</div>
            <div className={`${styles.badge} ${typeClass(item.type)}`}>{item.type}</div>
            <p className={styles.reason}>{item.reason}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
