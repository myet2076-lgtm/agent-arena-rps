"use client";

import { useEffect, useMemo, useState } from "react";
import { MatchStatus, RoundOutcome, RoundPhase, type MatchDTO, type RoundDTO } from "@/types";
import { useMatchSSE } from "@/app/hooks/useMatchSSE";
import { useRoundAnimation } from "@/app/hooks/useRoundAnimation";
import { ScoreBoard } from "./ScoreBoard";
import { BattleStage } from "./BattleStage";
import { RoundTimeline } from "./RoundTimeline";
import styles from "./ArenaStage.module.css";

interface ArenaStageProps {
  matchId: string | null;
  waitingCount: number;
}

interface MatchDetailRound {
  round: number;
  moveA: RoundDTO["moveA"];
  moveB: RoundDTO["moveB"];
  winner: "A" | "B" | null;
  predictionBonusA: boolean;
  predictionBonusB: boolean;
  pointsA: number;
  pointsB: number;
  resolvedAt: string | null;
}

interface MatchDetailResponse {
  match: MatchDTO;
  rounds: MatchDetailRound[];
}

function isQualificationMatch(match: { agentA: string; agentB: string }): boolean {
  const a = match.agentA.toLowerCase();
  const b = match.agentB.toLowerCase();
  return a.includes("house-bot") || b.includes("house-bot") || a.startsWith("qual-") || b.startsWith("qual-");
}

function winnerToOutcome(winner: "A" | "B" | null): RoundDTO["outcome"] {
  if (winner === "A") {
    return RoundOutcome.WIN_A;
  }

  if (winner === "B") {
    return RoundOutcome.WIN_B;
  }

  return RoundOutcome.DRAW;
}

function toRoundDTO(matchId: string, round: MatchDetailRound): RoundDTO {
  return {
    id: `resolved-${matchId}-${round.round}`,
    matchId,
    roundNo: round.round,
    phase: RoundPhase.PUBLISHED,
    moveA: round.moveA,
    moveB: round.moveB,
    outcome: winnerToOutcome(round.winner),
    pointsA: round.pointsA,
    pointsB: round.pointsB,
    predictionBonusA: round.predictionBonusA,
    predictionBonusB: round.predictionBonusB,
    violationA: null,
    violationB: null,
    judgedAt: round.resolvedAt,
    createdAt: round.resolvedAt ?? new Date().toISOString(),
  };
}

export function ArenaStage({ matchId, waitingCount }: ArenaStageProps): React.JSX.Element {
  const [match, setMatch] = useState<MatchDTO | null>(null);
  const [rounds, setRounds] = useState<RoundDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { latestEvent, connected } = useMatchSSE(matchId);
  const animState = useRoundAnimation(latestEvent, match?.agentA ?? null, match?.agentB ?? null);

  useEffect(() => {
    if (!matchId) {
      setMatch(null);
      setRounds([]);
      setError(null);
      return;
    }

    async function loadDetail(): Promise<void> {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/matches/${matchId}`, { cache: "no-store" });
        if (!res.ok) {
          throw new Error("Failed to load live match");
        }

        const data = (await res.json()) as MatchDetailResponse;
        if (!data.match || isQualificationMatch(data.match)) {
          setMatch(null);
          setRounds([]);
          return;
        }

        setMatch(data.match);
        setRounds((data.rounds ?? []).map((round) => toRoundDTO(data.match.id, round)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load live match");
      } finally {
        setLoading(false);
      }
    }

    void loadDetail();
  }, [matchId]);

  useEffect(() => {
    if (!latestEvent || !matchId) {
      return;
    }

    if (latestEvent.type === "ROUND_RESULT") {
      setMatch((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          scoreA: latestEvent.scoreA,
          scoreB: latestEvent.scoreB,
          currentRound: latestEvent.roundNo,
        };
      });

      setRounds((prev) => {
        const withoutCurrent = prev.filter((round) => round.roundNo !== latestEvent.roundNo);
        const merged: RoundDTO = {
          id: `evt-${matchId}-${latestEvent.roundNo}`,
          matchId,
          roundNo: latestEvent.roundNo,
          phase: RoundPhase.PUBLISHED,
          moveA: latestEvent.moveA ?? null,
          moveB: latestEvent.moveB ?? null,
          outcome: latestEvent.outcome,
          pointsA: latestEvent.pointsA,
          pointsB: latestEvent.pointsB,
          predictionBonusA: latestEvent.predictionBonusA,
          predictionBonusB: latestEvent.predictionBonusB,
          violationA: null,
          violationB: null,
          judgedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };

        return [...withoutCurrent, merged].sort((a, b) => a.roundNo - b.roundNo);
      });
    }

    if (latestEvent.type === "MATCH_FINISHED") {
      setMatch((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          status: MatchStatus.FINISHED,
          winnerId: latestEvent.winnerId,
          scoreA: latestEvent.finalScoreA,
          scoreB: latestEvent.finalScoreB,
          finishedAt: new Date().toISOString(),
        };
      });
    }
  }, [latestEvent, matchId]);

  const headerText = useMemo(() => {
    if (!match) {
      return `Waiting for next match... ${waitingCount} agents in queue`;
    }

    return `Live: ${match.agentA} vs ${match.agentB}`;
  }, [match, waitingCount]);

  if (!matchId || !match) {
    return (
      <section className={styles.stage}>
        <h2 className={styles.waitingTitle}>Waiting for next match...</h2>
        <p className={styles.waitingMeta}>{waitingCount} agents in queue</p>
        <div className={styles.chatPlaceholder}>Live Chat coming soon</div>
      </section>
    );
  }

  return (
    <section className={styles.stage}>
      <div className={styles.liveHeader}>
        <h2>{headerText}</h2>
        <span className={`${styles.connection} ${connected ? styles.connected : styles.disconnected}`}>
          {connected ? "SSE LIVE" : "RECONNECTING"}
        </span>
      </div>

      {loading ? <p className={styles.state}>Loading match…</p> : null}
      {error ? <p className={styles.state}>{error}</p> : null}

      {!loading && !error ? (
        <>
          <ScoreBoard match={match} />
          <BattleStage animState={animState} agentA={match.agentA} agentB={match.agentB} waitingCount={waitingCount} />
          <RoundTimeline rounds={rounds} />
        </>
      ) : null}

      <div className={styles.chatPlaceholder}>Live Chat coming soon</div>
    </section>
  );
}
