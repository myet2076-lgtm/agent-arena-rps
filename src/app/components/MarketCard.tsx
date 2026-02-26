import type { MarketSnapshotDTO } from "@/types";
import styles from "./MarketCard.module.css";

interface MarketCardProps {
  market: MarketSnapshotDTO | null;
  marketUrl?: string;
}

export function MarketCard({ market, marketUrl = "https://polymarket.com" }: MarketCardProps) {
  if (!market) {
    return (
      <section className={styles.card}>
        <h3>Prediction Market</h3>
        <p className={styles.dim}>No live market is connected for this match yet.</p>
      </section>
    );
  }

  const aPct = Math.round(market.impliedProbA * 100);
  const bPct = Math.round(market.impliedProbB * 100);

  return (
    <section className={styles.card}>
      <h3>Prediction Market</h3>
      <div className={styles.row}>
        <span className={styles.a}>Agent A {aPct}%</span>
        <span className={styles.b}>Agent B {bPct}%</span>
      </div>
      <div className={styles.bar}>
        <div className={styles.aFill} style={{ width: `${aPct}%` }} />
      </div>
      <div className={styles.dim}>Volume: ${market.volume.toLocaleString()}</div>
      <a className={styles.link} href={marketUrl} target="_blank" rel="noopener noreferrer">
        View on Polymarket →
      </a>
    </section>
  );
}
