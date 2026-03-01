/**
 * Demo Match — Auto-plays showcase matches so the homepage shows live battle animations.
 */

import { db } from "@/lib/server/in-memory-db";
import { createHash, randomBytes } from "node:crypto";
import { generateApiKey, hashApiKey } from "@/lib/server/auth";
import { AgentStatus, MatchStatus, Move, type Match } from "@/types";
import {
  startReadyCheck,
  markReady,
  transitionToReveal,
  handleBothRevealed,
} from "./match-scheduler";

const MOVES: Move[] = [Move.ROCK, Move.PAPER, Move.SCISSORS];
const DEMO_PAIRS = [
  ["RyuBot", "KenBot"],
  ["AkumaAI", "ChunLiAI"],
  ["TerryBot", "IoriBot"],
];

let demoRunning = false;

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureAgent(name: string): string {
  const id = `demo-${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const existing = db.getAgent(id);
  if (existing) {
    if (existing.status !== AgentStatus.QUALIFIED) {
      db.updateAgent({ ...existing, status: AgentStatus.QUALIFIED, updatedAt: new Date() });
    }
    return id;
  }
  const key = generateApiKey();
  const now = new Date();
  db.createAgent({
    id,
    name,
    keyHash: hashApiKey(key),
    description: "Demo bot",
    status: AgentStatus.QUALIFIED,
    elo: 1500 + Math.floor(Math.random() * 200 - 100),
    createdAt: now,
    updatedAt: now,
    qualifiedAt: now,
    queueCooldownUntil: null,
    queueBanUntil: null,
    consecutiveTimeouts: 0,
    suspiciousFlag: false,
    consecutiveMatches: 0,
    consecutiveQualFails: 0,
    lastQualFailAt: null,
    settings: { autoRequeue: false, maxConsecutiveMatches: 5, restBetweenSec: 30, allowedIps: [] },
  });
  return id;
}

function createDemoMatch(idA: string, idB: string): string {
  const mid = `demo-${Date.now()}`;
  const now = new Date();
  db.updateMatch({
    id: mid,
    seasonId: "season-1",
    agentA: idA,
    agentB: idB,
    status: MatchStatus.CREATED,
    format: "BO7" as Match["format"],
    scoreA: 0,
    scoreB: 0,
    winsA: 0,
    winsB: 0,
    currentRound: 0,
    maxRounds: 12,
    winnerId: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    readyA: false,
    readyB: false,
    readyDeadline: new Date(Date.now() + 30000),
    currentPhase: "READY_CHECK" as Match["currentPhase"],
    phaseDeadline: new Date(Date.now() + 30000),
    eloChangeA: null,
    eloChangeB: null,
    eloUpdatedAt: null,
  });
  return mid;
}

async function waitForPhase(mid: string, phase: string, round: number, maxWait: number): Promise<boolean> {
  for (let i = 0; i < maxWait; i++) {
    const m = db.getMatch(mid);
    if (!m || m.status === MatchStatus.FINISHED) return false;
    if (m.currentPhase === phase && (round === 0 || m.currentRound === round)) return true;
    await sleep(500);
  }
  return false;
}

async function playDemoMatch(): Promise<void> {
  const pair = rand(DEMO_PAIRS);
  const idA = ensureAgent(pair[0]);
  const idB = ensureAgent(pair[1]);
  const mid = createDemoMatch(idA, idB);

  console.log(`[Demo] 🎮 ${pair[0]} vs ${pair[1]} (${mid})`);

  // Ready phase
  startReadyCheck(mid);
  await sleep(1500);
  markReady(mid, idA);
  await sleep(800);
  markReady(mid, idB);
  // markReady triggers transitionToCommit(mid, 1) internally

  for (let rnd = 1; rnd <= 12; rnd++) {
    try {
      // Wait for COMMIT phase
      const ready = await waitForPhase(mid, "COMMIT", rnd, 20);
      if (!ready) {
        const m = db.getMatch(mid);
        if (m?.status === MatchStatus.FINISHED) {
          console.log(`[Demo] 🏆 Winner: ${m.winnerId ?? "DRAW"} (score ${m.scoreA}-${m.scoreB})`);
        }
        break;
      }

      const moveA = rand(MOVES);
      const moveB = rand(MOVES);
      const nonceA = randomBytes(16).toString("hex");
      const nonceB = randomBytes(16).toString("hex");
      const hashA = createHash("sha256").update(`${moveA}:${nonceA}`).digest("hex");
      const hashB = createHash("sha256").update(`${moveB}:${nonceB}`).digest("hex");

      // Commit both
      db.upsertCommit(mid, rnd, idA, hashA);
      await sleep(600);
      db.upsertCommit(mid, rnd, idB, hashB);

      // Transition to REVEAL
      transitionToReveal(mid, rnd);
      await sleep(1500);

      // Reveal both
      db.upsertReveal(mid, rnd, idA, moveA, nonceA);
      await sleep(500);
      db.upsertReveal(mid, rnd, idB, moveB, nonceB);

      // Resolve round (triggers SSE events)
      handleBothRevealed(mid, rnd);

      const updated = db.getMatch(mid);
      console.log(`[Demo]   R${rnd}: ${moveA} vs ${moveB} → ${updated?.scoreA ?? "?"}-${updated?.scoreB ?? "?"}`);

      if (updated?.status === MatchStatus.FINISHED) {
        console.log(`[Demo] 🏆 Winner: ${updated.winnerId ?? "DRAW"}`);
        break;
      }

      // Dramatic pause
      await sleep(3500);
    } catch (err) {
      console.error(`[Demo] Round ${rnd} error:`, err);
      break;
    }
  }
}

export async function startDemoLoop(): Promise<void> {
  if (demoRunning) return;
  demoRunning = true;
  console.log("[Demo] Demo match loop started");

  while (demoRunning) {
    try {
      await playDemoMatch();
    } catch (err) {
      console.error("[Demo] Match error:", err);
    }
    await sleep(8000);
  }
}

export function stopDemoLoop(): void {
  demoRunning = false;
}
