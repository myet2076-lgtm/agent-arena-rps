"use client";

import { useClientDemo } from "@/app/hooks/useClientDemo";
import { useRoundAnimation } from "@/app/hooks/useRoundAnimation";
import { ScoreBoard } from "./ScoreBoard";
import { BattleStage } from "./BattleStage";
import { RoundTimeline } from "./RoundTimeline";
import type { SoundName } from "@/app/hooks/useArcadeSounds";
import type { MatchDTO, RoundDTO } from "@/types";
import styles from "./ArenaStage.module.css";

interface ClientDemoStageProps {
  playSound?: (sound: SoundName) => void;
  waitingCount: number;
  watchAgentId?: string | null;
}

export function ClientDemoStage({ playSound, waitingCount }: ClientDemoStageProps) {
  const { match, events, latestEvent } = useClientDemo(true);

  const animState = useRoundAnimation(
    latestEvent,
    match?.agentA ?? null,
    match?.agentB ?? null,
  );

  if (!match) {
    return (
      <section className={styles.stage}>
        <h2 className={styles.waitingTitle}>Loading demo match...</h2>
        <p className={styles.waitingMeta}>{waitingCount} agents in queue</p>
      </section>
    );
  }

  // Convert to MatchDTO-like shape for ScoreBoard/BattleStage
  const matchDTO = {
    id: match.id,
    agentA: match.agentA,
    agentB: match.agentB,
    agentAName: match.agentAName,
    agentBName: match.agentBName,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    status: match.status,
    bestOf: match.bestOf,
    currentRound: match.currentRound,
    winnerId: null,
    createdAt: new Date().toISOString(),
    readyDeadline: null,
    phaseTick: null,
    roundPhase: null,
  } as unknown as MatchDTO;

  const roundDTOs: RoundDTO[] = match.rounds.map(r => ({
    roundNo: r.round,
    moveA: r.moveA,
    moveB: r.moveB,
    outcome: r.outcome,
    pointsA: r.pointsA,
    pointsB: r.pointsB,
    predictionBonusA: false,
    predictionBonusB: false,
  })) as unknown as RoundDTO[];

  return (
    <section className={styles.stage}>
      <div className={styles.liveHeader}>
        <h2>{match.agentAName} vs {match.agentBName}</h2>
        <span className={styles.sseBadge}>🎮 CLIENT DEMO</span>
      </div>
      <ScoreBoard match={matchDTO} isDemo={true} />
      <BattleStage
        animState={animState}
        agentA={match.agentA}
        agentB={match.agentB}
        agentAName={match.agentAName}
        agentBName={match.agentBName}
        waitingCount={waitingCount}
        playSound={playSound}
      />
      <RoundTimeline rounds={roundDTOs} />
    </section>
  );
}
