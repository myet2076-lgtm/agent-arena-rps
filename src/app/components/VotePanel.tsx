"use client";

import { useEffect, useMemo, useState } from "react";
import { MatchStatus } from "@/types";
import styles from "./VotePanel.module.css";

interface VotePanelProps {
  matchId: string;
  currentRound: number;
  status: MatchStatus;
  votesA: number;
  votesB: number;
  onVoteUpdate: (next: { a: number; b: number }) => void;
}

const viewerStorageKey = "agent-arena-viewer-id";

function getViewerId(): string {
  const existing = localStorage.getItem(viewerStorageKey);
  if (existing) return existing;
  const created = `viewer-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(viewerStorageKey, created);
  return created;
}

function voteRoundKey(matchId: string, roundNo: number): string {
  return `agent-arena-vote:${matchId}:${roundNo}`;
}

export function VotePanel({ matchId, currentRound, status, votesA, votesB, onVoteUpdate }: VotePanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [votedSide, setVotedSide] = useState<"A" | "B" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disabled = status === MatchStatus.FINISHED || status === MatchStatus.ARCHIVED || submitting;

  useEffect(() => {
    const saved = localStorage.getItem(voteRoundKey(matchId, currentRound));
    if (saved === "A" || saved === "B") {
      setVotedSide(saved);
      return;
    }
    setVotedSide(null);
  }, [matchId, currentRound]);

  const total = votesA + votesB;
  const aPct = useMemo(() => (total === 0 ? 50 : Math.round((votesA / total) * 100)), [votesA, total]);

  async function castVote(side: "A" | "B") {
    if (disabled || votedSide) return;
    setSubmitting(true);
    setError(null);

    try {
      const viewerId = getViewerId();
      const response = await fetch(`/api/matches/${matchId}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewerId, side, roundNo: currentRound > 0 ? currentRound : null }),
      });

      const payload = (await response.json()) as { tally?: { a: number; b: number }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Vote failed");

      localStorage.setItem(voteRoundKey(matchId, currentRound), side);
      setVotedSide(side);

      if (payload.tally) {
        onVoteUpdate(payload.tally);
      }
    } catch (error) {
      console.error(error);
      setError("Vote failed — try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.card}>
      <h3>Who takes this round?</h3>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={disabled || Boolean(votedSide)}
          className={styles.aButton}
          onClick={() => castVote("A")}
        >
          {votedSide === "A" ? "✅ " : ""}🔵 Agent A
        </button>
        <button
          type="button"
          disabled={disabled || Boolean(votedSide)}
          className={styles.bButton}
          onClick={() => castVote("B")}
        >
          {votedSide === "B" ? "✅ " : ""}🔴 Agent B
        </button>
      </div>

      <div className={styles.voteBar}>
        <div className={styles.aFill} style={{ width: `${aPct}%` }} />
      </div>
      <div className={styles.meta}>
        <span>{votesA} votes</span>
        <span>{votesB} votes</span>
      </div>

      {status === MatchStatus.FINISHED && <div className={styles.dim}>Voting closed — match finished.</div>}
      {votedSide && status !== MatchStatus.FINISHED && <div className={styles.dim}>Vote locked for this round.</div>}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
