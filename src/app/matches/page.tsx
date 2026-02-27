"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/app/components/NavBar";
import styles from "./matches-list.module.css";

type FilterType = "ALL" | "RUNNING" | "FINISHED";

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
  createdAt?: string;
}

export default function MatchesListPage(): React.JSX.Element {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [filter, setFilter] = useState<FilterType>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const res = await fetch("/api/matches", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load matches");
        const data = (await res.json()) as { matches?: MatchSummary[] };
        setMatches(data.matches ?? []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load data. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    void load();
    const interval = setInterval(() => void load(), 10_000);
    return () => clearInterval(interval);
  }, []);

  function refetch(): void {
    setLoading(true);
    setError(null);
    void fetch("/api/matches", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load matches");
        const data = (await res.json()) as { matches?: MatchSummary[] };
        setMatches(data.matches ?? []);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load data. Please try again.");
      })
      .finally(() => setLoading(false));
  }

  const filtered =
    filter === "ALL"
      ? matches
      : matches.filter((m) => m.status === filter);

  return (
    <section className={styles.page}>
      <div className={styles.heroSection}>
        <NavBar />
        <img
          src="https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=2400&q=95&fit=crop&auto=format&dpr=2"
          alt="Match Arena"
          className={styles.heroImage}
        />
        <div className={styles.heroOverlay}>
          <div className={styles.heroText}>
            <h1 className={styles.heroTitle}>Matches</h1>
            <p className={styles.heroSub}>Browse all battles</p>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.filters}>
          {(["ALL", "RUNNING", "FINISHED"] as FilterType[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "ALL" ? "All" : f === "RUNNING" ? "🔴 Running" : "✅ Finished"}
            </button>
          ))}
        </div>

        {loading && (
          <div className={styles.state}>
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
          </div>
        )}

        {error && (
          <div className={styles.errorCard}>
            {error}
            <button type="button" onClick={refetch} className={styles.retryBtn}>Retry</button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className={styles.state}>No matches found</div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className={styles.grid}>
            {filtered.map((m) => (
              <Link key={m.id} href={`/matches/${m.id}`} className={styles.card}>
                <div className={styles.cardHeader}>
                  <span className={`${styles.statusBadge} ${m.status === "RUNNING" ? styles.running : styles.finished}`}>
                    {m.status === "RUNNING" ? "🔴 Live" : "✅ Finished"}
                  </span>
                  {m.createdAt && (
                    <span className={styles.date}>
                      {new Date(m.createdAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <h3 className={styles.cardTitle}>{m.agentA} vs {m.agentB}</h3>
                <div className={styles.cardFooter}>
                  <span className={styles.score}>{m.scoreA} – {m.scoreB}</span>
                  {m.currentRound != null && m.maxRounds != null && (
                    <span className={styles.round}>Round {m.currentRound}/{m.maxRounds}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
