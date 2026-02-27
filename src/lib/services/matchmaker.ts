/**
 * Matchmaker Service (PRD §3.2)
 * FIFO matching when queue has ≥ 2 WAITING entries
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/in-memory-db";
import { AgentStatus, MatchStatus } from "@/types";
import { emitQueueEvent, type QueueEvent } from "./queue-events";

export interface MatchResult {
  matchId: string;
  agentA: string;
  agentB: string;
}

export function tryMatch(): MatchResult | null {
  const waiting = db.listQueueEntries("WAITING"); // sorted by joinedAt
  if (waiting.length < 2) return null;

  const [entryA, entryB] = [waiting[0], waiting[1]];
  const now = new Date();
  const matchId = randomUUID();

  // Create match
  db.updateMatch({
    id: matchId,
    seasonId: "season-1",
    agentA: entryA.agentId,
    agentB: entryB.agentId,
    status: MatchStatus.CREATED,
    format: "BO7",
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
  });

  // Update queue entries
  db.updateQueueEntry({ ...entryA, status: "MATCHED" });
  db.updateQueueEntry({ ...entryB, status: "MATCHED" });

  // Update agent statuses
  const agentA = db.getAgent(entryA.agentId);
  const agentB = db.getAgent(entryB.agentId);
  if (agentA) db.updateAgent({ ...agentA, status: AgentStatus.MATCHED, updatedAt: now });
  if (agentB) db.updateAgent({ ...agentB, status: AgentStatus.MATCHED, updatedAt: now });

  // Emit events
  emitQueueEvent(entryA.agentId, {
    type: "MATCH_ASSIGNED",
    agentId: entryA.agentId,
    matchId,
    opponentId: entryB.agentId,
  });
  emitQueueEvent(entryB.agentId, {
    type: "MATCH_ASSIGNED",
    agentId: entryB.agentId,
    matchId,
    opponentId: entryA.agentId,
  });

  // Then REMOVED with reason MATCHED
  emitQueueEvent(entryA.agentId, { type: "REMOVED", agentId: entryA.agentId, reason: "MATCHED" });
  emitQueueEvent(entryB.agentId, { type: "REMOVED", agentId: entryB.agentId, reason: "MATCHED" });

  return { matchId, agentA: entryA.agentId, agentB: entryB.agentId };
}
