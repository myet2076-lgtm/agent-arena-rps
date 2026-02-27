/**
 * Qualification Service (PRD §3.3, F02)
 * Manages qualification matches against house-bot
 * Format: BO3 (first to 2 wins)
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

const TOTAL_ROUNDS = 3; // BO3
const WIN_THRESHOLD = 2; // First to 2 wins
const FIRST_FAIL_COOLDOWN_MS = 60_000;       // 60s
const HARSH_COOLDOWN_MS = 24 * 60 * 60_000;  // 24h
const HARSH_THRESHOLD = 5; // PRD F02: consecutiveQualFails >= 5 → 24h cooldown

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
  opponent: string;
  format: string;
  difficulty: QualDifficulty;
} {
  const agent = db.getAgent(agentId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found");

  // PRD F02: status must be REGISTERED → error 403 INVALID_STATE
  if (agent.status !== AgentStatus.REGISTERED) {
    throw new ApiError(403, "INVALID_STATE", `Agent status is ${agent.status}, must be REGISTERED`);
  }

  // Check cooldown using lastQualFailAt (PRD F02)
  if (agent.lastQualFailAt) {
    const cooldownMs = (agent.consecutiveQualFails >= HARSH_THRESHOLD)
      ? HARSH_COOLDOWN_MS
      : FIRST_FAIL_COOLDOWN_MS;
    const cooldownEnd = agent.lastQualFailAt.getTime() + cooldownMs;
    if (Date.now() < cooldownEnd) {
      const retryAfter = Math.ceil((cooldownEnd - Date.now()) / 1000);
      throw new ApiError(429, "QUALIFICATION_COOLDOWN", `Qualification cooldown active, retry after ${retryAfter}s`, {
        retryAfter,
      });
    }
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
    opponent: "house-bot",
    format: "BO3",
    difficulty,
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
  opponentMove: Move;
  result: "WIN" | "LOSE" | "DRAW";
  score: { you: number; opponent: number };
  qualStatus: "IN_PROGRESS" | "PASSED" | "FAILED";
} {
  const qualMatch = db.getQualificationMatch(qualMatchId);
  if (!qualMatch) throw new ApiError(404, "NOT_FOUND", "Qualification match not found");
  if (qualMatch.agentId !== agentId) throw new ApiError(403, "FORBIDDEN", "Not your qualification match");
  if (qualMatch.result !== "PENDING") throw new ApiError(409, "QUAL_ALREADY_COMPLETE", "Qualification already completed");

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

  // Check completion (BO3: first to 2 wins)
  let matchStatus: "IN_PROGRESS" | "PASSED" | "FAILED" = "IN_PROGRESS";
  const roundsPlayed = qualMatch.rounds.length;
  const roundsRemaining = TOTAL_ROUNDS - roundsPlayed;

  if (agentWins >= WIN_THRESHOLD) {
    matchStatus = "PASSED";
  } else if (botWins >= WIN_THRESHOLD) {
    matchStatus = "FAILED";
  } else if (roundsRemaining === 0) {
    // All rounds played, agent didn't reach threshold
    matchStatus = agentWins >= WIN_THRESHOLD ? "PASSED" : "FAILED";
  } else if (agentWins + roundsRemaining < WIN_THRESHOLD) {
    // Can't reach threshold even with remaining rounds
    matchStatus = "FAILED";
  }

  if (matchStatus !== "IN_PROGRESS") {
    qualMatch.result = matchStatus === "PASSED" ? "PASS" : "FAIL";
    qualMatch.completedAt = new Date();
    activeBots.delete(qualMatchId);

    const agent = db.getAgent(agentId)!;
    if (matchStatus === "PASSED") {
      // PRD F02: pass → consecutiveQualFails = 0, qualifiedAt = now
      db.updateAgent({
        ...agent,
        status: AgentStatus.QUALIFIED,
        updatedAt: new Date(),
        consecutiveQualFails: 0,
        qualifiedAt: new Date(),
        lastQualFailAt: null,
      });
    } else {
      // PRD F02: fail → consecutiveQualFails++, lastQualFailAt = now
      const newFails = (agent.consecutiveQualFails ?? 0) + 1;
      db.updateAgent({
        ...agent,
        status: AgentStatus.REGISTERED,
        updatedAt: new Date(),
        consecutiveQualFails: newFails,
        lastQualFailAt: new Date(),
      });
    }
  }

  db.updateQualificationMatch(qualMatch);

  return {
    round: roundNo,
    yourMove: move,
    opponentMove: botMove,
    result: roundResult,
    score: { you: agentWins, opponent: botWins },
    qualStatus: matchStatus === "PASSED" ? "PASSED" : matchStatus === "FAILED" ? "FAILED" : "IN_PROGRESS",
  };
}

/** Reset active bots (for testing) */
export function resetQualService(): void {
  activeBots.clear();
}
