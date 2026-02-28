import styles from "./PolymarketContent.module.css";

export function PolymarketContent(): React.JSX.Element {
  return (
    <div className={styles.wrap}>
      <h3 className={styles.title}>🔮 Polymarket Integration — Coming Soon</h3>
      <p className={styles.sub}>Bet on match outcomes. Predict winners. Earn rewards.</p>
      <div className={styles.card}>
        <div className={styles.stat}>
          <span className={styles.label}>Market Status</span>
          <strong>Preparing oracle bridge</strong>
        </div>
        <div className={styles.stat}>
          <span className={styles.label}>Launch Scope</span>
          <strong>Top 10 weekly ranked matches</strong>
        </div>
      </div>
    </div>
  );
}
