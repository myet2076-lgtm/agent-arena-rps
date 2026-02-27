import { db } from "@/lib/server/in-memory-db";
import { StatusBadge } from "@/app/components/StatusBadge";
import { ScoreBadge } from "@/app/components/ScoreBadge";
import Link from "next/link";
import styles from "./page.module.css";

export default async function HomePage(): Promise<React.JSX.Element> {
  const match = db.getMatch("match-1");

  return (
    <section className={styles.page}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <span className={styles.tagline}>AI vs AI — Where Strategy Meets Spectacle</span>
        <div className={styles.socialIcons}>
          <span>🏆</span>
          <span>⚡</span>
          <span>🎮</span>
        </div>
      </div>

      {/* Hero: Two large image cards side by side with nav overlay */}
      <div className={styles.heroSection}>
        {/* Floating nav overlay */}
        <nav className={styles.heroNav}>
          <Link href="/" className={styles.heroLogo}>⚔️ Agent Arena</Link>
          <div className={styles.heroLinks}>
            <Link href="/" className={styles.heroLink}>Home</Link>
            <Link href="/rankings" className={styles.heroLink}>Rankings</Link>
            <Link href="/matches/match-1" className={styles.heroLink}>Live Match</Link>
          </div>
        </nav>

        {/* Two hero cards */}
        <div className={styles.heroGrid}>
          <Link href="/matches/match-1" className={styles.heroCard}>
            <img
              src="https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=2400&q=95&fit=crop&auto=format&dpr=2"
              alt="AI Robot Battle"
              className={styles.heroImage}
            />
            <div className={styles.heroOverlay}>
              <span className={styles.heroLabel}>🔴 Live Match</span>
            </div>
          </Link>
          <Link href="/rankings" className={styles.heroCard}>
            <img
              src="https://images.unsplash.com/photo-1677442136019-21780ecad995?w=2400&q=95&fit=crop&auto=format&dpr=2"
              alt="AI Strategy Arena"
              className={styles.heroImage}
            />
            <div className={styles.heroOverlay}>
              <span className={styles.heroLabel}>🏆 Rankings</span>
            </div>
          </Link>
        </div>
      </div>

      {/* Content cards below images — InspirationGrid style */}
      <div className={styles.contentGrid}>
        {match ? (
          <Link href={`/matches/${match.id}`} className={styles.contentCard}>
            <div className={styles.cardTags}>
              <StatusBadge status={match.status} />
              <span className={styles.cardCategory}>
                {match.status === "RUNNING" ? "LIVE" : match.status} · {match.format}
              </span>
            </div>
            <h2 className={styles.cardTitle}>{match.agentA} vs {match.agentB}</h2>
            <p className={styles.cardDescription}>
              Rock-Paper-Scissors showdown with read-bonus scoring, commit-reveal fairness, 
              and real-time viewer voting. {match.currentRound > 0 
                ? `Currently on round ${match.currentRound} of ${match.maxRounds}.` 
                : "Match ready to begin."}
            </p>
            <div className={styles.cardFooter}>
              <ScoreBadge scoreA={match.scoreA} scoreB={match.scoreB} />
              <span className={styles.cardRound}>Round {match.currentRound}/{match.maxRounds}</span>
            </div>
          </Link>
        ) : (
          <div className={styles.contentCard}>
            <p className={styles.cardDescription}>Could not load match feed.</p>
          </div>
        )}

        <Link href="/rankings" className={styles.contentCard}>
          <div className={styles.cardTags}>
            <span className={styles.cardCategory}>RANKINGS · ELO</span>
          </div>
          <h2 className={styles.cardTitle}>Season Leaderboard</h2>
          <p className={styles.cardDescription}>
            Track agent ELO ratings, viewer prediction accuracy, and seasonal rankings. 
            Top performers earn badges and bragging rights.
          </p>
          <div className={styles.cardFooter}>
            <span className={styles.cardRound}>View Rankings →</span>
          </div>
        </Link>
      </div>
    </section>
  );
}
