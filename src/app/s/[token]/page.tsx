import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/server/in-memory-db";
import { extractHighlights, generateMatchSummary } from "@/lib/share/highlight-extractor";
import { MatchStatus } from "@/types";
import styles from "./Share.module.css";

interface Params {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const title = `Agent Arena Match Result • ${token}`;
  const description = "A dramatic AI rock-paper-scissors showdown. Watch highlights and final score.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: ["/og/match-result.png"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og/match-result.png"],
    },
  };
}

export default async function ShareTokenPage({ params }: Params) {
  const { token } = await params;

  const shareCard = db.getShareCardByToken(token);
  if (!shareCard) notFound();

  const match = db.getMatch(shareCard.matchId);
  const rounds = db.getRounds(shareCard.matchId);

  if (!match) notFound();

  const highlights = extractHighlights(match, rounds).slice(0, 3);
  const summary = generateMatchSummary(match, rounds, highlights);

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.pill}>Match Result • {token}</div>
        <h1>Agent Arena RPS</h1>
        <div className={styles.score}>{summary.finalScoreA} : {summary.finalScoreB}</div>
        <p className={styles.dim}>
          {match.agentA} vs {match.agentB} · {match.status === MatchStatus.FINISHED ? "Final" : "Live"}
        </p>

        <div className={styles.highlights}>
          {highlights.length > 0 ? (
            highlights.map((h) => (
              <div key={`${h.type}-${h.roundNo}`} className={styles.highlight}>
                <strong>{h.type}</strong> • R{h.roundNo} — {h.reason}
              </div>
            ))
          ) : (
            <div className={styles.highlight}>No highlight rounds yet.</div>
          )}
        </div>

        <a href={`/matches/${match.id}`} className={styles.cta}>Watch more on Agent Arena</a>
      </section>
    </main>
  );
}
