"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { MatchStatus, type MarketSnapshotDTO, type MatchResponseDTO, type RoundDTO } from "@/types";
import { extractHighlights, generateMatchSummary } from "@/lib/share/highlight-extractor";
import { useMatchSSE } from "@/app/hooks/useMatchSSE";
import { NavBar } from "@/app/components/NavBar";
import { ScoreBoard } from "@/app/components/ScoreBoard";
import { RoundTimeline } from "@/app/components/RoundTimeline";
import { VotePanel } from "@/app/components/VotePanel";
import { MarketCard } from "@/app/components/MarketCard";
import { HighlightsPanel } from "@/app/components/HighlightsPanel";
import styles from "./Match.module.css";

interface MatchState {
  data: MatchResponseDTO | null;
  loading: boolean;
  error: string | null;
}

export default function MatchPage() {
  const params = useParams<{ id: string }>();
  const matchId = params?.id ?? null;
  const [state, setState] = useState<MatchState>({ data: null, loading: true, error: null });
  const [liveMarket, setLiveMarket] = useState<MarketSnapshotDTO | null>(null);

  const { latestEvent, connected } = useMatchSSE(matchId);

  const loadMatch = useCallback(async () => {
    if (!matchId) return;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetch(`/api/matches/${matchId}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to load match (${response.status})`);
      const payload = (await response.json()) as MatchResponseDTO;
      setState({ data: payload, loading: false, error: null });
      setLiveMarket(payload.market);
    } catch (error) {
      setState({ data: null, loading: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }, [matchId]);

  useEffect(() => {
    loadMatch();
  }, [loadMatch]);

  useEffect(() => {
    if (!latestEvent) return;

    setState((prev) => {
      if (!prev.data || latestEvent.matchId !== prev.data.match.id) return prev;
      const next = { ...prev.data };

      if (latestEvent.type === "VOTE_UPDATE") {
        next.votes = { a: latestEvent.votesA, b: latestEvent.votesB };
      }

      if (latestEvent.type === "MARKET_UPDATE") {
        setLiveMarket((current) => ({
          id: current?.id ?? `live-${latestEvent.matchId}`,
          marketMappingId: current?.marketMappingId ?? `mapping-${latestEvent.matchId}`,
          impliedProbA: latestEvent.impliedProbA,
          impliedProbB: latestEvent.impliedProbB,
          volume: latestEvent.volume,
          capturedAt: new Date().toISOString(),
        }));
      }

      if (latestEvent.type === "ROUND_RESULT") {
        next.match.scoreA = latestEvent.scoreA;
        next.match.scoreB = latestEvent.scoreB;
        void loadMatch();
      }

      if (latestEvent.type === "MATCH_FINISHED") {
        next.match.status = MatchStatus.FINISHED;
        next.match.winnerId = latestEvent.winnerId;
        next.match.scoreA = latestEvent.finalScoreA;
        next.match.scoreB = latestEvent.finalScoreB;
        void loadMatch();
      }

      return { ...prev, data: next };
    });
  }, [latestEvent, loadMatch]);

  const match = state.data?.match;
  const rounds: RoundDTO[] = state.data?.rounds ?? [];
  const votes = state.data?.votes ?? { a: 0, b: 0 };
  const baseMarket = state.data?.market ?? null;

  const highlights = useMemo(() => {
    if (!match || match.status !== MatchStatus.FINISHED) return [];
    return extractHighlights(match, rounds);
  }, [match, rounds]);

  const summary = useMemo(() => {
    if (!match || match.status !== MatchStatus.FINISHED) return null;
    return generateMatchSummary(match, rounds, highlights);
  }, [highlights, match, rounds]);

  if (state.loading) {
    return <main className={styles.page}><div className={styles.content}><div className={styles.state}>Loading match feed…</div></div></main>;
  }

  if (state.error || !match) {
    return <main className={styles.page}><div className={styles.content}><div className={styles.stateError}>Error: {state.error ?? "Match not found"}</div></div></main>;
  }

  const liveRound = Math.min(Math.max(match.currentRound, rounds.length + 1), match.maxRounds);

  return (
    <main className={styles.page}>
      <section className={styles.heroSection}>
        <NavBar />
        <img
          src="https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=2400&q=95&fit=crop&auto=format&dpr=2"
          alt="Battle Arena"
          className={styles.heroImage}
        />
        <div className={styles.heroOverlay}>
          <div className={styles.heroText}>
            <h1 className={styles.heroTitle}>{match.agentA} vs {match.agentB}</h1>
            <div className={styles.heroSub}>
              <span>Match {match.id}</span>
              <span className={`${styles.connection} ${connected ? styles.online : styles.offline}`} role="status" aria-live="polite">
                {connected ? "● Live" : "○ Reconnecting"}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.content}>
        <ScoreBoard match={match} />

        <section className={styles.liveRound}>
          <div>
            <div className={styles.label}>Live Round</div>
            <div className={styles.roundNo}>Round {liveRound}</div>
          </div>
          <div className={styles.countdownPulse}>⏱️ commits resolving...</div>
        </section>

        <section className={styles.cardSection}>
          <h2>Round History</h2>
          <RoundTimeline rounds={rounds} />
        </section>

        <section className={styles.interactionGrid}>
          <VotePanel
            matchId={match.id}
            currentRound={liveRound}
            status={match.status}
            votesA={votes.a}
            votesB={votes.b}
            onVoteUpdate={(next) => {
              setState((prev) => (prev.data ? { ...prev, data: { ...prev.data, votes: next } } : prev));
            }}
          />
          <MarketCard market={liveMarket ?? baseMarket} />
        </section>

        {match.status === MatchStatus.FINISHED && summary && (
          <HighlightsPanel summary={summary} highlights={highlights} />
        )}
      </div>
    </main>
  );
}
