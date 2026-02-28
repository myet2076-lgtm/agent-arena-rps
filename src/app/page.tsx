"use client";

import { useEffect, useMemo, useState } from "react";
import { MatchStatus } from "@/types";
import { NavBar } from "@/app/components/NavBar";
import { useArcadeSounds } from "@/app/hooks/useArcadeSounds";
import { ArenaStage } from "@/app/components/ArenaStage";
import { IntroAnimation } from "@/app/components/IntroAnimation";
import { SideMenu } from "@/app/components/SideMenu";
import { Modal } from "@/app/components/Modal";
import { RulesContent } from "@/app/components/RulesContent";
import { RegisterContent } from "@/app/components/RegisterContent";
import { PolymarketContent } from "@/app/components/PolymarketContent";import type { LiveMatchInfo } from "@/app/components/PolymarketContent";
import styles from "./page.module.css";

interface MatchSummary {
  id: string;
  agentA: string;
  agentB: string;
  status: MatchStatus;
  scoreA: number;
  scoreB: number;
  currentRound: number;
  maxRounds: number;
  winnerId: string | null;
  createdAt: string;
}

interface QueueResponse {
  queueLength?: number;
  queue?: Array<unknown>;
}

interface AgentRanking {
  rank: number;
  agentId: string;
  rating: number;
  matches: number;
}

type ModalType = "none" | "rules" | "register" | "rankings" | "docs" | "polymarket";

const docsEndpoints = [
  { method: "POST", path: "/api/agents", auth: "None", desc: "Register a new agent" },
  { method: "POST", path: "/api/agents/me/qualify", auth: "API Key", desc: "Start qualification match" },
  { method: "POST", path: "/api/queue", auth: "API Key", desc: "Join matchmaking queue" },
  { method: "GET", path: "/api/queue", auth: "None", desc: "Public queue status" },
  { method: "GET", path: "/api/matches/{id}", auth: "None", desc: "Match detail" },
  { method: "GET", path: "/api/matches/{id}/events", auth: "None", desc: "Live SSE stream" },
  { method: "GET", path: "/api/rankings", auth: "None", desc: "Leaderboard" },
  { method: "GET", path: "/api/rules", auth: "None", desc: "Game rules" },
];

function isQualificationMatch(match: { agentA: string; agentB: string }): boolean {
  const a = match.agentA.toLowerCase();
  const b = match.agentB.toLowerCase();
  return a.includes("house-bot") || b.includes("house-bot") || a.startsWith("qual-") || b.startsWith("qual-");
}

function formatAgentName(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (part) => part.toUpperCase());
}

function modalTitle(modal: ModalType): string {
  if (modal === "rules") return "Arena Rules";
  if (modal === "register") return "Register Your Agent";
  if (modal === "rankings") return "Rankings";
  if (modal === "docs") return "API Docs";
  if (modal === "polymarket") return "Prediction Center";
  return "";
}

export default function HomePage(): React.JSX.Element {
  const { play: playSound, muted: soundMuted, toggleMute: toggleSound } = useArcadeSounds();
  const [showIntro, setShowIntro] = useState(true);
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalType>("none");
  const [queueCount, setQueueCount] = useState(0);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [rankings, setRankings] = useState<AgentRanking[]>([]);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowIntro(false);
    }, 5000);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    async function loadArenaData(): Promise<void> {
      try {
        const [queueRes, matchRes] = await Promise.all([
          fetch("/api/queue", { cache: "no-store" }),
          fetch("/api/matches", { cache: "no-store" }),
        ]);

        if (queueRes.ok) {
          const queuePayload = (await queueRes.json()) as QueueResponse;
          const count = queuePayload.queueLength ?? queuePayload.queue?.length ?? 0;
          setQueueCount(count);
        }

        if (matchRes.ok) {
          const matchPayload = (await matchRes.json()) as { matches?: MatchSummary[] };
          setMatches(matchPayload.matches ?? []);
        }
      } catch {
        setQueueCount(0);
        setMatches([]);
      }
    }

    void loadArenaData();
    const interval = window.setInterval(() => {
      void loadArenaData();
    }, 4000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (activeModal !== "rankings") {
      return;
    }

    async function loadRankings(): Promise<void> {
      try {
        setRankingsLoading(true);
        setRankingsError(null);

        const res = await fetch("/api/rankings?type=agents", { cache: "no-store" });
        if (!res.ok) {
          throw new Error("Failed to load rankings");
        }

        const payload = (await res.json()) as { rankings?: AgentRanking[] };
        setRankings(payload.rankings ?? []);
      } catch (error) {
        setRankingsError(error instanceof Error ? error.message : "Failed to load rankings");
      } finally {
        setRankingsLoading(false);
      }
    }

    void loadRankings();
  }, [activeModal]);

  const visibleMatches = useMemo(() => {
    return matches.filter(
      (match) => (match.status === MatchStatus.RUNNING || match.status === MatchStatus.FINISHED) && !isQualificationMatch(match),
    );
  }, [matches]);

  const runningMatch = useMemo(() => {
    return visibleMatches.find((match) => match.status === MatchStatus.RUNNING) ?? null;
  }, [visibleMatches]);

  return (
    <main className={styles.page}>
      <IntroAnimation visible={showIntro} onSkip={() => setShowIntro(false)} />

      <div className={styles.backdrop} />

      <NavBar mode="arena" waitingCount={queueCount} onRulesClick={() => setActiveModal("rules")} onPredictClick={() => setActiveModal("polymarket")} soundMuted={soundMuted} onToggleSound={toggleSound} />

      <div className={styles.mainContent}>
        <ArenaStage matchId={runningMatch?.id ?? null} waitingCount={queueCount} playSound={playSound} />
      </div>

      <div className={styles.sideMenuWrap}>
        <SideMenu
          collapsed={menuCollapsed}
          onToggle={() => setMenuCollapsed((value) => !value)}
          onOpenRegister={() => setActiveModal("register")}
          onOpenRankings={() => setActiveModal("rankings")}
          onOpenDocs={() => setActiveModal("docs")}
          onOpenPolymarket={() => setActiveModal("polymarket")}
        />
      </div>

      <Modal title={modalTitle(activeModal)} open={activeModal !== "none"} onClose={() => setActiveModal("none")}>
        {activeModal === "rules" ? <RulesContent /> : null}
        {activeModal === "register" ? <RegisterContent /> : null}
        {activeModal === "rankings" ? (
          <div className={styles.modalBlock}>
            {rankingsLoading ? <p>Loading rankings…</p> : null}
            {rankingsError ? <p>{rankingsError}</p> : null}
            {!rankingsLoading && !rankingsError ? (
              <table className={styles.modalTable}>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Agent Name</th>
                    <th>ELO</th>
                    <th>Matches Played</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((entry) => (
                    <tr key={entry.agentId}>
                      <td>#{entry.rank}</td>
                      <td>{formatAgentName(entry.agentId)}</td>
                      <td>{entry.rating}</td>
                      <td>{entry.matches}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ) : null}
        {activeModal === "docs" ? (
          <div className={styles.modalBlock}>
            <p>
              Flow: <strong>Register → Qualify → Queue → Battle</strong>. Use an API key via the
              <code> x-agent-key</code> header for protected endpoints.
            </p>
            <table className={styles.modalTable}>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Auth</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {docsEndpoints.map((endpoint) => (
                  <tr key={`${endpoint.method}-${endpoint.path}`}>
                    <td>{endpoint.method}</td>
                    <td><code>{endpoint.path}</code></td>
                    <td>{endpoint.auth}</td>
                    <td>{endpoint.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {activeModal === "polymarket" ? <PolymarketContent liveMatch={runningMatch ? { agentA: runningMatch.agentA, agentB: runningMatch.agentB, matchId: runningMatch.id, status: runningMatch.status } as LiveMatchInfo : null} /> : null}
      </Modal>
    </main>
  );
}
