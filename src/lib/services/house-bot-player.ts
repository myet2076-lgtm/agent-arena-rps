/**
 * House Bot Player — Auto-plays moves for the house bot in arena matches.
 * Listens to match lifecycle events and responds with commit + reveal.
 */

import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/server/in-memory-db";
import { AgentStatus, type AgentRecord, Move, DEFAULT_AGENT_SETTINGS } from "@/types";
import { HouseBot } from "@/lib/engine/house-bot";
import { markReady, transitionToReveal, handleBothRevealed } from "./match-scheduler";

export const HOUSE_BOT_ID = "house-bot";
export const HOUSE_BOT_NAME = "ArenaBot";

// Active house bot instances per match
const activeBots = new Map<string, HouseBot>();

/** Ensure the house bot agent record exists in the DB */
export function ensureHouseBotAgent(): void {
  if (db.getAgent(HOUSE_BOT_ID)) return;

  const now = new Date();
  const agent: AgentRecord = {
    id: HOUSE_BOT_ID,
    name: HOUSE_BOT_NAME,
    keyHash: "house-bot-no-key",
    status: AgentStatus.QUALIFIED,
    elo: 1500,
    description: "Arena house bot for auto-matching",
    createdAt: now,
    updatedAt: now,
    queueCooldownUntil: null,
    queueBanUntil: null,
    consecutiveTimeouts: 0,
    suspiciousFlag: false,
    settings: { ...DEFAULT_AGENT_SETTINGS },
    consecutiveMatches: 0,
    consecutiveQualFails: 0,
    qualifiedAt: now,
    lastQualFailAt: null,
  };

  db.createAgent(agent);
}

/** Check if an agent ID is the house bot */
export function isHouseBot(agentId: string): boolean {
  return agentId === HOUSE_BOT_ID;
}

/**
 * Called when a match involving the house bot starts READY_CHECK.
 * Auto-marks ready for the house bot.
 */
export function houseBotAutoReady(matchId: string): void {
  const match = db.getMatch(matchId);
  if (!match) return;

  if (!isHouseBot(match.agentA) && !isHouseBot(match.agentB)) return;

  // Create a bot instance for this match
  activeBots.set(matchId, new HouseBot("medium"));

  const opponentId = match.agentA === HOUSE_BOT_ID ? match.agentB : match.agentA;

  // Auto mark ready for BOTH house bot and opponent
  setTimeout(() => {
    const m = db.getMatch(matchId);
    if (m && m.currentPhase === "READY_CHECK") {
      markReady(matchId, HOUSE_BOT_ID);
    }
  }, 500);
  setTimeout(() => {
    const m = db.getMatch(matchId);
    if (m && m.currentPhase === "READY_CHECK") {
      markReady(matchId, opponentId);
    }
  }, 800);
}

/**
 * Called when a round enters COMMIT phase.
 * Auto-commits for the house bot.
 */
export function houseBotAutoCommit(matchId: string, roundNo: number): void {
  const match = db.getMatch(matchId);
  if (!match) return;

  if (!isHouseBot(match.agentA) && !isHouseBot(match.agentB)) return;

  const bot = activeBots.get(matchId) ?? new HouseBot("medium");
  activeBots.set(matchId, bot);

  // Determine opponent's history
  const opponentId = match.agentA === HOUSE_BOT_ID ? match.agentB : match.agentA;
  const rounds = db.getRounds(matchId);
  const opponentHistory: Move[] = rounds
    .filter((r) => r.roundNo < roundNo)
    .sort((a, b) => a.roundNo - b.roundNo)
    .map((r) => (opponentId === match.agentA ? r.moveA : r.moveB))
    .filter((m): m is Move => m !== null);

  const move = bot.nextMove(opponentHistory);
  const salt = randomBytes(16).toString("hex");
  const commitHash = createHash("sha256").update(`${move}:${salt}`).digest("hex");

  // Store move+salt for reveal phase
  houseBotMoves.set(`${matchId}:${roundNo}`, { move, salt });

  // Generate opponent's random move too
  const MOVES: Move[] = [Move.ROCK, Move.PAPER, Move.SCISSORS];
  const opponentMove = MOVES[Math.floor(Math.random() * 3)];
  const opponentSalt = randomBytes(16).toString("hex");
  const opponentHash = createHash("sha256").update(`${opponentMove}:${opponentSalt}`).digest("hex");
  houseBotMoves.set(`${matchId}:${roundNo}:opponent`, { move: opponentMove, salt: opponentSalt });

  // Auto-commit for house bot
  setTimeout(() => {
    const m = db.getMatch(matchId);
    if (!m || m.currentPhase !== "COMMIT" || m.currentRound !== roundNo) return;
    db.upsertCommit(matchId, roundNo, HOUSE_BOT_ID, commitHash);
  }, 800);

  // Auto-commit for opponent ONLY if they haven't already committed
  setTimeout(() => {
    const m = db.getMatch(matchId);
    if (!m || m.currentPhase !== "COMMIT" || m.currentRound !== roundNo) return;
    const existingOpponentCommit = db.getCommit(matchId, roundNo, opponentId);
    if (!existingOpponentCommit) {
      db.upsertCommit(matchId, roundNo, opponentId, opponentHash);
    }

    // Both committed now — transition
    const botCommit = db.getCommit(matchId, roundNo, HOUSE_BOT_ID);
    const oppCommit = db.getCommit(matchId, roundNo, opponentId);
    if (botCommit && oppCommit) {
      transitionToReveal(matchId, roundNo);
    }
  }, 1200);
}

/**
 * Called when a round enters REVEAL phase.
 * Auto-reveals for the house bot.
 */
export function houseBotAutoReveal(matchId: string, roundNo: number): void {
  const match = db.getMatch(matchId);
  if (!match) return;

  if (!isHouseBot(match.agentA) && !isHouseBot(match.agentB)) return;

  const stored = houseBotMoves.get(`${matchId}:${roundNo}`);
  if (!stored) return;

  const opponentId = match.agentA === HOUSE_BOT_ID ? match.agentB : match.agentA;

  const opponentStored = houseBotMoves.get(`${matchId}:${roundNo}:opponent`);

  // Auto-reveal for house bot
  setTimeout(() => {
    const m = db.getMatch(matchId);
    if (!m || m.currentPhase !== "REVEAL" || m.currentRound !== roundNo) return;
    db.upsertReveal(matchId, roundNo, HOUSE_BOT_ID, stored.move, stored.salt);
    db.verifyRevealDirect(matchId, roundNo, HOUSE_BOT_ID);
  }, 600);

  // Auto-reveal for opponent ONLY if they haven't already revealed
  setTimeout(() => {
    const m = db.getMatch(matchId);
    if (!m || m.currentPhase !== "REVEAL" || m.currentRound !== roundNo) return;
    const existingOpponentReveal = db.getReveal(matchId, roundNo, opponentId);
    if (!existingOpponentReveal && opponentStored) {
      db.upsertReveal(matchId, roundNo, opponentId, opponentStored.move, opponentStored.salt);
      db.verifyRevealDirect(matchId, roundNo, opponentId);
    }

    // Only resolve if both actually revealed
    const botReveal = db.getReveal(matchId, roundNo, HOUSE_BOT_ID);
    const oppReveal = db.getReveal(matchId, roundNo, opponentId);
    if (botReveal && oppReveal) {
      handleBothRevealed(matchId, roundNo);
    }

    // Clean up
    houseBotMoves.delete(`${matchId}:${roundNo}`);
    houseBotMoves.delete(`${matchId}:${roundNo}:opponent`);
  }, 1000);
}

// Store move+salt for reveal phase
const houseBotMoves = new Map<string, { move: Move; salt: string }>();

/** Clean up bot state for a finished match */
export function houseBotMatchCleanup(matchId: string): void {
  activeBots.delete(matchId);
  for (const key of houseBotMoves.keys()) {
    if (key.startsWith(`${matchId}:`)) {
      houseBotMoves.delete(key);
    }
  }
}

/** Reset all state (for testing) */
export function resetHouseBotPlayer(): void {
  activeBots.clear();
  houseBotMoves.clear();
}
