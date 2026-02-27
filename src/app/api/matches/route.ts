import { NextResponse } from "next/server";
import { db } from "@/lib/server/in-memory-db";

export function GET(): NextResponse {
  const allMatches = db.listMatches().map((m) => ({
    id: m.id,
    agentA: m.agentA,
    agentB: m.agentB,
    status: m.status,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    currentRound: m.currentRound,
    maxRounds: m.maxRounds,
    winnerId: m.winnerId,
    createdAt: m.createdAt,
  }));

  return NextResponse.json({ matches: allMatches });
}
