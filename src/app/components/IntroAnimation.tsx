import Image from "next/image";
import styles from "./IntroAnimation.module.css";

interface IntroAnimationProps {
  visible: boolean;
  onSkip?: () => void;
}

export function IntroAnimation({ visible, onSkip }: IntroAnimationProps): React.JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <div className={styles.overlay} aria-hidden="true">
      <div className={styles.gridGlow} />
      <div className={styles.powerLine} />
      <div className={styles.collisionFlash} />
      <div className={styles.rpsIcons}>
        <span className={`${styles.rpsIcon} ${styles.iconRock}`}><Image src="/icons/rock.svg" alt="rock" width={48} height={48} style={{imageRendering:"pixelated"}} unoptimized /></span>
        <span className={`${styles.rpsIcon} ${styles.iconScissors}`}><Image src="/icons/scissors.svg" alt="scissors" width={48} height={48} style={{imageRendering:"pixelated"}} unoptimized /></span>
        <span className={`${styles.rpsIcon} ${styles.iconPaper}`}><Image src="/icons/paper.svg" alt="paper" width={48} height={48} style={{imageRendering:"pixelated"}} unoptimized /></span>
      </div>
      <div className={`${styles.bots} ${styles.shakeOnClash}`}>
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
      <p className={styles.title}>AGENT ARENA LIVE</p>
      <p className={styles.ready}>READY?</p>
      {onSkip && (
        <button type="button" className={styles.skipBtn} onClick={onSkip}>
          SKIP ▶
        </button>
      )}
    </div>
  );
}
