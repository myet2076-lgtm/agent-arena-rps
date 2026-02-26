import styles from "./ScoreBadge.module.css";

interface ScoreBadgeProps {
  scoreA: number;
  scoreB: number;
}

export function ScoreBadge({ scoreA, scoreB }: ScoreBadgeProps): React.JSX.Element {
  return (
    <div className={styles.score}>
      <span className={styles.a}>{scoreA}</span>
      <span className={styles.sep}>:</span>
      <span className={styles.b}>{scoreB}</span>
    </div>
  );
}
