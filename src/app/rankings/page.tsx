// NOTE: This page is also available as a modal in the main arena page. Kept as a standalone route for external links.
"use client";

import { useEffect, useMemo, useState } from "react";
import { NavBar } from "@/app/components/NavBar";
import styles from "./Rankings.module.css";

type TabType = "agents" | "viewers";

interface AgentEntry {
  rank: number;
  agentId: string;
  name?: string;
  rating: number;
  matches: number;
  wins?: number;
  losses?: number;
  draws?: number;
}

interface ViewerEntry {
  rank: number;
  viewerId: string;
  hitRate: number;
  currentStreak: number;
  bestStreak: number;
  badges: string[];
  totalVotes?: number;
  correctVotes?: number;
}

function isAgentEntry(obj: unknown): obj is AgentEntry {
  if (typeof obj !== "object" || obj === null) return false;
  const row = obj as Record<string, unknown>;
  return typeof row.agentId === "string" && typeof row.rating === "number";
}

function isViewerEntry(obj: unknown): obj is ViewerEntry {
  if (typeof obj !== "object" || obj === null) return false;
  const row = obj as Record<string, unknown>;
  return typeof row.viewerId === "string" && typeof row.hitRate === "number";
}

function displayName(raw: string): string {
  return raw.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatRecord(entry: AgentEntry): string {
  if (entry.wins != null && entry.losses != null) {
    const draws = entry.draws ?? 0;
    return draws > 0 ? `${entry.wins}-${entry.losses}-${draws}` : `${entry.wins}-${entry.losses}`;
  }
  return "—";
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

        const validatedAgents = ((agentData as { rankings: unknown[] }).rankings).filter(isAgentEntry);
        const validatedViewers = ((viewerData as { rankings: unknown[] }).rankings).filter(isViewerEntry);

        setAgents(validatedAgents);
        setViewers(validatedViewers);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const topThreeAgents = useMemo(() => agents.slice(0, 3), [agents]);
  const topThreeViewers = useMemo(() => viewers.slice(0, 3), [viewers]);

  return (
    <section className={styles.page}>
      <div className={styles.heroSection}>
        <NavBar />
        <img
          src="https://images.unsplash.com/photo-1511512578047-dfb367046420?w=2400&q=95&fit=crop&auto=format&dpr=2"
          alt="Gaming Arena Leaderboard"
          className={styles.heroImage}
        />
        <div className={styles.heroOverlay}>
          <div className={styles.heroText}>
            <h1 className={styles.heroTitle}>Arena Rankings</h1>
            <p className={styles.heroSub}>Track elite ELO climbs and the sharpest viewer predictions.</p>
          </div>
        </div>
      </div>

      <div className={styles.content}>
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
              {tab === "agents"
                ? topThreeAgents.map((row, index) => {
                  const glow = index === 0 ? styles.gold : index === 1 ? styles.cyan : styles.magenta;
                  const label = `${displayName(row.agentId)} · ${row.rating} ELO`;

                  return (
                    <article key={row.agentId} className={`${styles.podiumCard} ${glow}`}>
                      <strong>#{index + 1}</strong>
                      <span>{label}</span>
                    </article>
                  );
                })
                : topThreeViewers.map((row, index) => {
                  const glow = index === 0 ? styles.gold : index === 1 ? styles.cyan : styles.magenta;
                  const label = `${displayName(row.viewerId)} · ${Math.round(row.hitRate * 100)}%`;

                  return (
                    <article key={row.viewerId} className={`${styles.podiumCard} ${glow}`}>
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
                        <td>{formatRecord(entry)}</td>
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
      </div>
    </section>
  );
}
