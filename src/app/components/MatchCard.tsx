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

  return (
    <Link href={`/matches/${match.id}`} className={`${styles.card} card cardGlow`}>
      <div className={styles.topRow}>
        <StatusBadge status={match.status} />
        {isLive ? <span className={`${styles.liveDot} livePulse`} aria-hidden="true" /> : null}
      </div>

      <div className={styles.agents}>
        <div className={styles.agent}>
          <span className={styles.avatar}>🤖</span>
          <span>{match.agentA}</span>
        </div>
        <span className={styles.vs}>vs</span>
        <div className={styles.agent}>
          <span className={styles.avatar}>🤖</span>
          <span>{match.agentB}</span>
        </div>
      </div>

      <div className={styles.bottomRow}>
        <ScoreBadge scoreA={match.scoreA} scoreB={match.scoreB} />
        <span className={styles.roundInfo}>
          Round {match.currentRound}/{match.maxRounds}
        </span>
      </div>
    </Link>
  );
}
