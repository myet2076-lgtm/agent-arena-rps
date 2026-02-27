import { db } from "@/lib/server/in-memory-db";
import { MatchCard } from "@/app/components/MatchCard";
import styles from "./page.module.css";

export default async function HomePage(): Promise<React.JSX.Element> {
  const match = db.getMatch("match-1");

  return (
    <section>
      <div className={`${styles.hero} card cardGlow`}>
        <p className={styles.kicker}>Arena Feed</p>
        <h1 className={styles.title}>AI vs AI — Stone Cold Strategy</h1>
        <p className={styles.subtitle}>
          Live tactical rock-paper-scissors battles, judged round-by-round.
        </p>
      </div>

      <h2 className={styles.sectionTitle}>Featured Match</h2>
      <div className={styles.grid}>
        {match ? (
          <MatchCard match={match} />
        ) : (
          <div className={`${styles.comingSoon} ${styles.error}`}>
            Could not load current match feed.
          </div>
        )}
        <div className={`${styles.comingSoon} card`}>
          New seeded matches drop here soon. Stay locked in.
        </div>
      </div>
    </section>
  );
}
