"use client";

import { useEffect, useRef, useState } from "react";
import type { PredictionDraft } from "@/types/prediction";
import type { MatchStatus } from "@/types";
import styles from "./PolymarketContent.module.css";

export interface LiveMatchInfo {
  agentA: string;
  agentB: string;
  matchId: string;
  status: MatchStatus;
}

interface PolymarketContentProps {
  liveMatch?: LiveMatchInfo | null;
}

function formatName(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const confidenceLevels: PredictionDraft["confidence"][] = ["low", "medium", "high"];

export function PolymarketContent({ liveMatch }: PolymarketContentProps): React.JSX.Element {
  const [draft, setDraft] = useState<PredictionDraft>({
    matchId: liveMatch?.matchId ?? null,
    side: null,
    confidence: "medium",
    createdAt: new Date().toISOString(),
  });
  const [email, setEmail] = useState("");
  const [notifySaved, setNotifySaved] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const notifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync draft.matchId when liveMatch changes
  useEffect(() => {
    setDraft(prev => ({ ...prev, matchId: liveMatch?.matchId ?? null, side: null }));
  }, [liveMatch?.matchId]);

  // Cleanup notify timer on unmount
  useEffect(() => {
    return () => {
      if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
    };
  }, []);

  function selectSide(side: "A" | "B"): void {
    setDraft((prev) => ({ ...prev, side: prev.side === side ? null : side, matchId: liveMatch?.matchId ?? null }));
  }

  function selectConfidence(c: PredictionDraft["confidence"]): void {
    setDraft((prev) => ({ ...prev, confidence: c }));
  }

  function handleNotify(): void {
    setEmailError(null);
    if (email && !isValidEmail(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }
    setDraft((prev) => ({ ...prev, email: email || undefined }));
    setNotifySaved(true);
    notifyTimerRef.current = setTimeout(() => setNotifySaved(false), 3000);
  }

  const hasMatch = !!liveMatch;

  return (
    <div className={styles.wrap}>
      <h3 className={styles.title}>🔮 Prediction Center</h3>
      <p className={styles.subtitle}>Preview Mode — No funds are moved</p>

      {/* Match Card */}
      {hasMatch ? (
        <div className={styles.matchCard}>
          <span className={styles.matchLabel}>Live Match</span>
          <div className={styles.versus}>
            <button
              type="button"
              className={`${styles.sideBtn} ${styles.sideA} ${draft.side === "A" ? styles.selected : ""}`}
              onClick={() => selectSide("A")}
              aria-pressed={draft.side === "A"}
            >
              {formatName(liveMatch.agentA)}
            </button>
            <span className={styles.vs}>VS</span>
            <button
              type="button"
              className={`${styles.sideBtn} ${styles.sideB} ${draft.side === "B" ? styles.selected : ""}`}
              onClick={() => selectSide("B")}
              aria-pressed={draft.side === "B"}
            >
              {formatName(liveMatch.agentB)}
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.noMatch}>
          <p>No live match currently — predictions open when next battle starts</p>
        </div>
      )}

      {/* Confidence Selector */}
      <div className={styles.confidenceWrap}>
        <span className={styles.fieldLabel}>Confidence</span>
        <div className={styles.confidenceRow}>
          {confidenceLevels.map((level) => (
            <button
              key={level}
              type="button"
              className={`${styles.confBtn} ${draft.confidence === level ? styles.confSelected : ""}`}
              onClick={() => selectConfidence(level)}
              aria-pressed={draft.confidence === level}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Submit (disabled) */}
      <button type="button" className={styles.submitBtn} disabled>
        Coming Soon — Wallet integration pending
      </button>

      {/* Divider */}
      <hr className={styles.divider} />

      {/* Notify */}
      <div className={styles.notifyWrap}>
        <span className={styles.fieldLabel}>Notify me when live</span>
        <div className={styles.notifyRow}>
          <input
            type="email"
            className={styles.emailInput}
            placeholder="email (optional)"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setNotifySaved(false); setEmailError(null); }}
            aria-label="Email for notification"
          />
          <button type="button" className={styles.notifyBtn} onClick={handleNotify}>
            {notifySaved ? "✓ Saved" : "Save"}
          </button>
        </div>
        {emailError ? <p className={styles.emailError}>{emailError}</p> : null}
      </div>

      <p className={styles.disclaimer}>No funds are moved in this preview mode.</p>
    </div>
  );
}
