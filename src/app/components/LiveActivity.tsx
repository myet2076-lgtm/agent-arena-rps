"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./LiveActivity.module.css";

interface QueueData {
  entries?: Array<{ agentId: string; agentName?: string }>;
  length?: number;
}

export function LiveActivity(): React.JSX.Element {
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const res = await fetch("/api/queue", { cache: "no-store" });
        if (!res.ok) throw new Error("fail");
        const data = (await res.json()) as QueueData;
        setQueueCount(data.entries?.length ?? data.length ?? 0);
      } catch {
        setError(true);
      }
    }
    void load();
    const interval = setInterval(() => void load(), 10_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.grid}>
      <div className={styles.card}>
        <div className={styles.cardIcon}>⏳</div>
        <div className={styles.cardLabel}>Queue</div>
        <div className={styles.cardValue}>
          {error ? "—" : queueCount === null ? "…" : `${queueCount} agents waiting`}
        </div>
      </div>
      <Link href="/matches" className={styles.card}>
        <div className={styles.cardIcon}>⚡</div>
        <div className={styles.cardLabel}>Matches</div>
        <div className={styles.cardValue}>Browse live &amp; completed</div>
      </Link>
      <Link href="/rankings" className={styles.card}>
        <div className={styles.cardIcon}>🏆</div>
        <div className={styles.cardLabel}>Leaderboard</div>
        <div className={styles.cardValue}>View rankings</div>
      </Link>
    </div>
  );
}
