/**
 * Qualification Service (PRD §3.3)
 * Manages qualification matches against house-bot
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/in-memory-db";
import { ApiError } from "@/lib/server/api-error";
import { HouseBot } from "@/lib/engine/house-bot";
import {
  AgentStatus,
  Move,
  type QualDifficulty,
  type QualificationMatch,
  type QualRound,
} from "@/types";

const TOTAL_ROUNDS = 5;
const WIN_THRESHOLD = 3;
const FIRST_FAIL_COOLDOWN_MS = 60_000;       // 60s
const HARSH_COOLDOWN_MS = 24 * 60 * 60_000;  // 24h
const HARSH_THRESHOLD = 3; // consecutive fails before harsh cooldown

// Map of active house-bots by qualMatchId
const activeBots = new Map<string, HouseBot>();

function determineWinner(agentMove: Move, botMove: Move): "agent" | "bot" | "draw" {
  if (agentMove === botMove) return "draw";
  if (
    (agentMove === Move.ROCK && botMove === Move.SCISSORS) ||
    (agentMove === Move.PAPER && botMove === Move.ROCK) ||
    (agentMove === Move.SCISSORS && botMove === Move.PAPER)
  ) return "agent";
  return "bot";
}

export function startQualification(agentId: string, difficulty: QualDifficulty = "easy"): {
  qualMatchId: string;
  difficulty: QualDifficulty;
  totalRounds: number;
  firstRound: number;
} {
  const agent = db.getAgent(agentId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found");

  if (agent.status !== AgentStatus.REGISTERED) {
    throw new ApiError(403, "NOT_REGISTERED", `Agent status is ${agent.status}, must be REGISTERED`);
  }

  // Check cooldown
  if (agent.queueCooldownUntil && agent.queueCooldownUntil.getTime() > Date.now()) {
    const retryAfter = Math.ceil((agent.queueCooldownUntil.getTime() - Date.now()) / 1000);
    throw new ApiError(429, "QUAL_COOLDOWN", `Qualification cooldown active, retry after ${retryAfter}s`, {
      retryAfterSec: retryAfter,
    });
  }

  const qualMatch: QualificationMatch = {
    id: randomUUID(),
    agentId,
    difficulty,
    rounds: [],
    result: "PENDING",
    startedAt: new Date(),
    completedAt: null,
  };

  db.createQualificationMatch(qualMatch);
  db.updateAgent({ ...agent, status: AgentStatus.QUALIFYING, updatedAt: new Date() });

  // Create seeded bot for this match
  activeBots.set(qualMatch.id, new HouseBot(difficulty));

  return {
    qualMatchId: qualMatch.id,
    difficulty,
    totalRounds: TOTAL_ROUNDS,
    firstRound: 1,
  };
}

export function submitQualRound(
  agentId: string,
  qualMatchId: string,
  roundNo: number,
  move: Move,
): {
  round: number;
  yourMove: Move;
  botMove: Move;
  result: "WIN" | "LOSE" | "DRAW";
  score: { you: number; bot: number };
  status: "IN_PROGRESS" | "PASS" | "FAIL";
} {
  const qualMatch = db.getQualificationMatch(qualMatchId);
  if (!qualMatch) throw new ApiError(404, "QUAL_NOT_FOUND", "Qualification match not found");
  if (qualMatch.agentId !== agentId) throw new ApiError(403, "FORBIDDEN", "Not your qualification match");
  if (qualMatch.result !== "PENDING") throw new ApiError(400, "QUAL_COMPLETED", "Qualification already completed");

  const expectedRound = qualMatch.rounds.length + 1;
  if (roundNo !== expectedRound) {
    throw new ApiError(400, "INVALID_ROUND", `Expected round ${expectedRound}, got ${roundNo}`);
  }

  // Get bot move
  const bot = activeBots.get(qualMatchId) ?? new HouseBot(qualMatch.difficulty);
  const opponentHistory = qualMatch.rounds.map((r) => r.agentMove);
  const botMove = bot.nextMove(opponentHistory);

  const winner = determineWinner(move, botMove);
  const qr: QualRound = { round: roundNo, agentMove: move, botMove, winner };
  qualMatch.rounds.push(qr);

  // Calculate scores
  const agentWins = qualMatch.rounds.filter((r) => r.winner === "agent").length;
  const botWins = qualMatch.rounds.filter((r) => r.winner === "bot").length;

  const resultMap = { agent: "WIN" as const, bot: "LOSE" as const, draw: "DRAW" as const };
  const roundResult = resultMap[winner];

  // Check completion
  let matchStatus: "IN_PROGRESS" | "PASS" | "FAIL" = "IN_PROGRESS";
  const roundsPlayed = qualMatch.rounds.length;
  const roundsRemaining = TOTAL_ROUNDS - roundsPlayed;

  if (agentWins >= WIN_THRESHOLD) {
    matchStatus = "PASS";
  } else if (botWins >= WIN_THRESHOLD || (roundsRemaining === 0 && agentWins < WIN_THRESHOLD)) {
    // Can't reach threshold even with remaining rounds
    matchStatus = "FAIL";
  } else if (agentWins + roundsRemaining < WIN_THRESHOLD) {
    matchStatus = "FAIL";
  }

  if (matchStatus !== "IN_PROGRESS") {
    qualMatch.result = matchStatus === "PASS" ? "PASS" : "FAIL";
    qualMatch.completedAt = new Date();
    activeBots.delete(qualMatchId);

    const agent = db.getAgent(agentId)!;
    if (matchStatus === "PASS") {
      db.updateAgent({
        ...agent,
        status: AgentStatus.QUALIFIED,
        updatedAt: new Date(),
        queueCooldownUntil: null,
      });
    } else {
      // Increment consecutive fails
      const consecutiveFails = (agent as any).consecutiveQualFails ?? 0;
      const newFails = consecutiveFails + 1;
      const cooldownMs = newFails >= HARSH_THRESHOLD ? HARSH_COOLDOWN_MS : FIRST_FAIL_COOLDOWN_MS;

      db.updateAgent({
        ...agent,
        status: AgentStatus.REGISTERED,
        updatedAt: new Date(),
        queueCooldownUntil: new Date(Date.now() + cooldownMs),
        consecutiveQualFails: newFails,
      } as any);
    }
  }

  db.updateQualificationMatch(qualMatch);

  return {
    round: roundNo,
    yourMove: move,
    botMove,
    result: roundResult,
    score: { you: agentWins, bot: botWins },
    status: matchStatus,
  };
}

/** Reset active bots (for testing) */
export function resetQualService(): void {
  activeBots.clear();
}
