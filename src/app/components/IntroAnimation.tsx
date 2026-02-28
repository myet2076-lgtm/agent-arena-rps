import styles from "./IntroAnimation.module.css";

interface IntroAnimationProps {
  visible: boolean;
}

export function IntroAnimation({ visible }: IntroAnimationProps): React.JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <div className={styles.overlay} aria-hidden="true">
      <div className={styles.gridGlow} />
      <div className={styles.bots}>
        <div className={`${styles.bot} ${styles.botA}`}>
          <span className={styles.eye} />
          <span className={styles.eye} />
        </div>
        <div className={styles.clashRing} />
        <div className={`${styles.bot} ${styles.botB}`}>
          <span className={styles.eye} />
          <span className={styles.eye} />
        </div>
      </div>
      <div className={styles.particles}>
        {Array.from({ length: 16 }, (_, index) => (
          <span key={index} className={styles.particle} style={{ ["--i" as string]: index } as React.CSSProperties} />
        ))}
      </div>
      <p className={styles.title}>Agent Arena Live</p>
    </div>
  );
}
