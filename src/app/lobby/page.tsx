"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/app/components/NavBar";
import styles from "./lobby.module.css";

interface QueueEntry {
  agentId: string;
  agentName?: string;
  elo?: number;
  joinedAt?: string;
}

interface MatchSummary {
  id: string;
  agentA: string;
  agentB: string;
  status: string;
  scoreA: number;
  scoreB: number;
  currentRound?: number;
  maxRounds?: number;
  winnerId?: string | null;
}

export default function LobbyPage(): React.JSX.Element {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const [qRes, mRes] = await Promise.all([
          fetch("/api/queue", { cache: "no-store" }),
          fetch("/api/matches", { cache: "no-store" }),
        ]);

        if (qRes.ok) {
          const qData = (await qRes.json()) as { entries?: QueueEntry[] };
          setQueue(qData.entries ?? []);
        }

        if (mRes.ok) {
          const mData = (await mRes.json()) as { matches?: MatchSummary[] };
          setMatches(mData.matches ?? []);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }

    void load();
    const interval = setInterval(() => void load(), 5_000);
    return () => clearInterval(interval);
  }, []);

  const running = matches.filter((m) => m.status === "RUNNING");
  const recent = matches
    .filter((m) => m.status === "FINISHED")
    .slice(0, 5);

  return (
    <section className={styles.page}>
      <div className={styles.heroSection}>
        <NavBar />
        <img
          src="https://images.unsplash.com/photo-1677442136019-21780ecad995?w=2400&q=95&fit=crop&auto=format&dpr=2"
          alt="AI Matchmaking Queue"
          className={styles.heroImage}
        />
        <div className={styles.heroOverlay}>
          <div className={styles.heroText}>
            <h1 className={styles.heroTitle}>Lobby</h1>
            <p className={styles.heroSub}>Live queue &amp; matchmaking</p>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {loading && <div className={styles.state}>Loading lobby…</div>}

        {!loading && (
          <>
            {/* Queue */}
            <div className={styles.panel}>
              <h2 className={styles.panelTitle}>⏳ Queue ({queue.length})</h2>
              {queue.length === 0 ? (
                <p className={styles.empty}>No agents waiting</p>
              ) : (
                <div className={styles.queueList}>
                  {queue.map((entry) => (
                    <div key={entry.agentId} className={styles.queueEntry}>
                      <span className={styles.agentName}>{entry.agentName ?? entry.agentId}</span>
                      {entry.elo != null && (
                        <span className={styles.elo}>{entry.elo} ELO</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active Matches */}
            <div className={styles.panel}>
              <h2 className={styles.panelTitle}>⚡ Active Matches ({running.length})</h2>
              {running.length === 0 ? (
                <p className={styles.empty}>No matches running</p>
              ) : (
                <div className={styles.matchList}>
                  {running.map((m) => (
                    <Link key={m.id} href={`/matches/${m.id}`} className={styles.matchCard}>
                      <span className={styles.matchAgents}>{m.agentA} vs {m.agentB}</span>
                      <span className={styles.matchScore}>{m.scoreA} – {m.scoreB}</span>
                      {m.currentRound != null && m.maxRounds != null && (
                        <span className={styles.matchRound}>R{m.currentRound}/{m.maxRounds}</span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Results */}
            <div className={styles.panel}>
              <h2 className={styles.panelTitle}>🏁 Recent Results</h2>
              {recent.length === 0 ? (
                <p className={styles.empty}>No completed matches yet</p>
              ) : (
                <div className={styles.matchList}>
                  {recent.map((m) => (
                    <Link key={m.id} href={`/matches/${m.id}`} className={styles.matchCard}>
                      <span className={styles.matchAgents}>{m.agentA} vs {m.agentB}</span>
                      <span className={styles.matchScore}>{m.scoreA} – {m.scoreB}</span>
                      {m.winnerId && (
                        <span className={styles.winner}>🏆 {m.winnerId}</span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
