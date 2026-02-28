"use client";

import { useEffect, useRef, useState } from "react";
import { Move, RoundOutcome } from "@/types";
import type { AnimationPhase, RoundAnimationState } from "@/app/hooks/useRoundAnimation";
import type { SoundName } from "@/app/hooks/useArcadeSounds";
import styles from "./BattleStage.module.css";

interface BattleStageProps {
  animState: RoundAnimationState;
  agentA: string | null;
  agentB: string | null;
  waitingCount: number;
  playSound?: (sound: SoundName) => void;
}

const MOVE_EMOJI: Record<Move, string> = {
  [Move.ROCK]: "✊",
  [Move.PAPER]: "✋",
  [Move.SCISSORS]: "✌️",
};

const SLOT_ITEMS = ["✊", "✋", "✌️"];

function outcomeLabel(outcome: RoundOutcome | null): { text: string; isDraw: boolean } {
  if (!outcome) return { text: "", isDraw: false };
  if (outcome === RoundOutcome.DRAW) return { text: "DRAW", isDraw: true };
  return { text: "K.O.", isDraw: false };
}

function winnerSide(outcome: RoundOutcome | null): "A" | "B" | null {
  if (outcome === RoundOutcome.WIN_A || outcome === RoundOutcome.FORFEIT_B) return "A";
  if (outcome === RoundOutcome.WIN_B || outcome === RoundOutcome.FORFEIT_A) return "B";
  return null;
}

function Avatar({ side, phase, outcome }: { side: "left" | "right"; phase: AnimationPhase; outcome: RoundOutcome | null }) {
  const base = side === "left" ? styles.avatarLeft : styles.avatarRight;
  const ws = winnerSide(outcome);
  const isResultPhase = phase === "result";
  const isWinner = isResultPhase && ((side === "left" && ws === "A") || (side === "right" && ws === "B"));
  const isLoser = isResultPhase && ws !== null && !isWinner;
  const isIdle = phase === "idle";

  const cls = [
    base,
    isIdle ? styles.avatarIdle : "",
    isLoser ? styles.avatarDim : "",
    isLoser ? styles.avatarTilt : "",
    isWinner ? styles.avatarWin : "",
    isWinner ? styles.avatarBrightPulse : "",
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={cls}>{side === "left" ? "🤖" : "🤖"}</div>;
}

function IdleContent({ waitingCount }: { waitingCount: number }) {
  return (
    <div className={styles.waitingState}>
      <div className={styles.waitingAvatars}>
        <div className={`${styles.avatarLeft} ${styles.avatarIdle}`}>🤖</div>
        <div className={`${styles.avatarRight} ${styles.avatarIdle}`}>🤖</div>
      </div>
      <div className={styles.waitingText}>WAITING FOR CHALLENGERS...</div>
      <div className={styles.waitingQueue}>{waitingCount} IN QUEUE</div>
    </div>
  );
}

function RoundAnnounceContent({ roundNo }: { roundNo: number }) {
  return <div className={styles.roundAnnounce}>ROUND {roundNo}</div>;
}

function ChoosingContent() {
  const [indexA, setIndexA] = useState(0);
  const [indexB, setIndexB] = useState(1);

  useEffect(() => {
    const intervalA = setInterval(() => {
      setIndexA((prev) => (prev + 1) % SLOT_ITEMS.length);
    }, 100);
    const intervalB = setInterval(() => {
      setIndexB((prev) => (prev + 1) % SLOT_ITEMS.length);
    }, 120);
    return () => {
      clearInterval(intervalA);
      clearInterval(intervalB);
    };
  }, []);

  return (
    <div className={styles.choosingArea}>
      <div className={styles.slotMachine}>
        <span className={styles.slotReel}>{SLOT_ITEMS[indexA]}</span>
      </div>
      <span className={styles.choosingVs}>VS</span>
      <div className={styles.slotMachine}>
        <span className={styles.slotReel}>{SLOT_ITEMS[indexB]}</span>
      </div>
    </div>
  );
}

function RevealContent({ moveA, moveB }: { moveA: Move | null; moveB: Move | null }) {
  return (
    <div className={styles.revealArea}>
      <span className={`${styles.moveDisplay} ${styles.moveRevealLeft}`}>
        {moveA ? MOVE_EMOJI[moveA] : "❓"}
      </span>
      <div className={`${styles.revealFlash} ${styles.flashLeft}`} />
      <div className={`${styles.revealFlash} ${styles.flashRight}`} />
      <span className={`${styles.moveDisplay} ${styles.moveRevealRight}`}>
        {moveB ? MOVE_EMOJI[moveB] : "❓"}
      </span>
    </div>
  );
}

function ClashContent({ moveA, moveB }: { moveA: Move | null; moveB: Move | null }) {
  return (
    <div className={styles.clashArea}>
      <span className={styles.clashMoveLeft}>{moveA ? MOVE_EMOJI[moveA] : "❓"}</span>
      <div className={styles.impactFlash} />
      <div className={styles.clashRadial} />
      <span className={styles.clashMoveRight}>{moveB ? MOVE_EMOJI[moveB] : "❓"}</span>
    </div>
  );
}

function ResultContent({ moveA, moveB, outcome }: { moveA: Move | null; moveB: Move | null; outcome: RoundOutcome | null }) {
  const { text, isDraw } = outcomeLabel(outcome);
  const ws = winnerSide(outcome);
  return (
    <div className={styles.resultArea}>
      <div className={styles.resultMoves}>
        <span>{moveA ? MOVE_EMOJI[moveA] : "❓"}</span>
        <span className={styles.resultVs}>VS</span>
        <span>{moveB ? MOVE_EMOJI[moveB] : "❓"}</span>
      </div>
      <div className={`${styles.resultText} ${isDraw ? styles.resultDraw : styles.resultKO}`}>
        {text}
      </div>
      {ws && (
        <div className={styles.resultConfetti}>
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className={`${styles.resultConfettiPiece} ${ws === "A" ? styles.confettiLeft : styles.confettiRight}`}
              style={{ ["--ci" as string]: i } as React.CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchEndContent({ winnerId, winnerName }: { winnerId: string | null; winnerName: string | null }) {
  const confettiPieces = Array.from({ length: 8 }, (_, i) => (
    <div key={i} className={styles.confettiPiece} />
  ));

  return (
    <div className={styles.matchEndOverlay}>
      {winnerId ? (
        <>
          <div className={styles.matchEndTitle}>🏆 WINNER</div>
          <div className={styles.matchEndName}>{winnerName ?? winnerId}</div>
        </>
      ) : (
        <div className={styles.matchEndDraw}>DRAW MATCH</div>
      )}
      <div className={styles.confetti}>{confettiPieces}</div>
    </div>
  );
}

export function BattleStage({ animState, agentA, agentB, waitingCount, playSound }: BattleStageProps): React.JSX.Element {
  const { phase, roundNo, moveA, moveB, outcome, winnerId, winnerName } = animState;
  const prevPhaseRef = useRef<AnimationPhase>("idle");

  // Sound integration: play sounds on phase transitions
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (!playSound || prev === phase) return;

    switch (phase) {
      case "round-announce":
        playSound("roundAnnounce");
        break;
      case "choosing":
        // Entry sound removed; tick loop handles choosing sound
        break;
      case "reveal":
        playSound("reveal");
        break;
      case "clash":
        playSound("clash");
        break;
      case "result":
        // Sound handled by dedicated outcome watcher useEffect
        break;
      case "match-end":
        playSound("winner");
        break;
    }
  }, [phase, outcome, playSound]);

  // Play result sound when outcome arrives (may come after phase transition)
  useEffect(() => {
    if (phase !== "result" || !outcome || !playSound) return;
    if (outcome === RoundOutcome.DRAW) {
      playSound("draw");
    } else {
      playSound("ko");
    }
  }, [outcome, phase, playSound]);

  // Choosing tick sound loop
  useEffect(() => {
    if (phase !== "choosing" || !playSound) return;
    const interval = setInterval(() => {
      playSound("choosing");
    }, 300);
    return () => clearInterval(interval);
  }, [phase, playSound]);

  const shakeClass = phase === "round-announce"
    ? styles.shakeRoundAnnounce
    : phase === "clash"
      ? styles.shakeClash
      : phase === "choosing"
        ? styles.shakeChoosing
        : "";

  const showAvatars = phase !== "idle" || (agentA !== null && agentB !== null);
  const isMatchActive = agentA !== null && agentB !== null;

  if (!isMatchActive && phase === "idle") {
    return (
      <div className={styles.battleStage}>
        <IdleContent waitingCount={waitingCount} />
      </div>
    );
  }

  const centerContent = (() => {
    switch (phase) {
      case "idle":
        return null;
      case "round-announce":
        return <RoundAnnounceContent roundNo={roundNo} />;
      case "choosing":
        return <ChoosingContent />;
      case "reveal":
        return <RevealContent moveA={moveA} moveB={moveB} />;
      case "clash":
        return <ClashContent moveA={moveA} moveB={moveB} />;
      case "result":
        return <ResultContent moveA={moveA} moveB={moveB} outcome={outcome} />;
      case "match-end":
        return <MatchEndContent winnerId={winnerId} winnerName={winnerName} />;
      default:
        return null;
    }
  })();

  return (
    <div className={`${styles.battleStage} ${shakeClass}`}>
      {showAvatars && phase !== "match-end" && (
        <Avatar side="left" phase={phase} outcome={outcome} />
      )}
      <div className={styles.centerArea}>{centerContent}</div>
      {showAvatars && phase !== "match-end" && (
        <Avatar side="right" phase={phase} outcome={outcome} />
      )}
    </div>
  );
}
