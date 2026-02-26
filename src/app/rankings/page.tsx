"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./Rankings.module.css";

type TabType = "agents" | "viewers";

interface AgentEntry {
  rank: number;
  agentId: string;
  rating: number;
  matches: number;
}

interface ViewerEntry {
  rank: number;
  viewerId: string;
  hitRate: number;
  currentStreak: number;
  bestStreak: number;
  badges: string[];
}

function displayName(raw: string): string {
  return raw.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveRecord(entry: AgentEntry): string {
  const wins = Math.max(0, Math.min(entry.matches, Math.round((entry.rating - 1200) / 20 + entry.matches / 2)));
  const losses = Math.max(0, entry.matches - wins);
  return `${wins}-${losses}`;
}

export default function RankingsPage(): React.JSX.Element {
  const [tab, setTab] = useState<TabType>("agents");
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [viewers, setViewers] = useState<ViewerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);

        const [agentRes, viewerRes] = await Promise.all([
          fetch("/api/rankings?type=agents", { cache: "no-store" }),
          fetch("/api/rankings?type=viewers&period=weekly", { cache: "no-store" }),
        ]);

        if (!agentRes.ok || !viewerRes.ok) {
          throw new Error("Failed to load rankings");
        }

        const agentData: unknown = await agentRes.json();
        const viewerData: unknown = await viewerRes.json();

        if (
          !agentData
          || typeof agentData !== "object"
          || !Array.isArray((agentData as { rankings?: unknown }).rankings)
        ) {
          setError("Invalid response");
          return;
        }

        if (
          !viewerData
          || typeof viewerData !== "object"
          || !Array.isArray((viewerData as { rankings?: unknown }).rankings)
        ) {
          setError("Invalid response");
          return;
        }

        setAgents((agentData as { rankings: AgentEntry[] }).rankings);
        setViewers((viewerData as { rankings: ViewerEntry[] }).rankings);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const topThree = useMemo(() => {
    return (tab === "agents" ? agents : viewers).slice(0, 3);
  }, [agents, viewers, tab]);

  return (
    <section className={styles.page}>
      <header className={`${styles.header} card cardGlow`}>
        <h1 className={styles.title}>Arena Rankings</h1>
        <p className={styles.subtitle}>Track elite ELO climbs and the sharpest viewer predictions.</p>
      </header>

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === "agents" ? styles.tabActive : ""}`}
          onClick={() => setTab("agents")}
        >
          Agent ELO
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === "viewers" ? styles.tabActive : ""}`}
          onClick={() => setTab("viewers")}
        >
          Viewer Accuracy
        </button>
      </div>

      {loading ? <div className={styles.state}>Loading rankings…</div> : null}
      {error ? <div className={`${styles.state} ${styles.error}`}>{error}</div> : null}

      {!loading && !error ? (
        <>
          <div className={styles.podium}>
            {topThree.map((row, index) => {
              const glow = index === 0 ? styles.gold : index === 1 ? styles.cyan : styles.magenta;
              const label = tab === "agents"
                ? `${displayName((row as AgentEntry).agentId)} · ${(row as AgentEntry).rating} ELO`
                : `${displayName((row as ViewerEntry).viewerId)} · ${Math.round((row as ViewerEntry).hitRate * 100)}%`;

              return (
                <article key={tab === "agents" ? (row as AgentEntry).agentId : (row as ViewerEntry).viewerId} className={`${styles.podiumCard} ${glow}`}>
                  <strong>#{index + 1}</strong>
                  <span>{label}</span>
                </article>
              );
            })}
          </div>

          {tab === "agents" ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th>ELO</th>
                    <th>W/L</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((entry) => (
                    <tr key={entry.agentId}>
                      <td>#{entry.rank}</td>
                      <td>{displayName(entry.agentId)}</td>
                      <td>{entry.rating}</td>
                      <td>{deriveRecord(entry)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>ID</th>
                    <th>Hit Rate</th>
                    <th>Current Streak</th>
                    <th>Best Streak</th>
                    <th>Badges</th>
                  </tr>
                </thead>
                <tbody>
                  {viewers.map((entry) => (
                    <tr key={entry.viewerId}>
                      <td>#{entry.rank}</td>
                      <td>{entry.viewerId}</td>
                      <td>{Math.round(entry.hitRate * 100)}%</td>
                      <td>{entry.currentStreak}</td>
                      <td>{entry.bestStreak}</td>
                      <td>
                        <div className={styles.badges}>
                          {entry.badges.length > 0 ? (
                            entry.badges.map((badge) => (
                              <span className={styles.badge} key={badge}>
                                {badge}
                              </span>
                            ))
                          ) : (
                            <span className={styles.badge}>None</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
