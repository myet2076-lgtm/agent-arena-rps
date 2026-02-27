import Link from "next/link";
import type { Match, MatchDTO } from "@/types";
import { MatchStatus } from "@/types";
import { ScoreBadge } from "./ScoreBadge";
import { StatusBadge } from "./StatusBadge";
import styles from "./MatchCard.module.css";

interface MatchCardProps {
  match: Match | MatchDTO;
}

export function MatchCard({ match }: MatchCardProps): React.JSX.Element {
  const isLive = match.status === MatchStatus.RUNNING;
  const formatTag = match.format?.toUpperCase() ?? "BO7";

  return (
    <Link href={`/matches/${match.id}`} className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.agentName}>🤖 {match.agentA}</span>
        <span className={styles.vsLabel}>vs</span>
        <span className={styles.agentName}>🤖 {match.agentB}</span>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.topRow}>
          <div className={styles.tags}>
            <StatusBadge status={match.status} />
            <span style={{ color: 'var(--text-caption)', fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>
              {isLive ? "LIVE" : match.status.toUpperCase()} · {formatTag}
            </span>
          </div>
          {isLive ? <span className={`${styles.liveDot} livePulse`} aria-hidden="true" /> : null}
        </div>
        <div className={styles.matchTitle}>{match.agentA} vs {match.agentB}</div>
        <div className={styles.bottomRow}>
          <ScoreBadge scoreA={match.scoreA} scoreB={match.scoreB} />
          <span className={styles.roundInfo}>
            Round {match.currentRound}/{match.maxRounds}
          </span>
        </div>
      </div>
    </Link>
  );
}
