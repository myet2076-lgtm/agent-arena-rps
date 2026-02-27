import { NextResponse } from "next/server";
import { db } from "@/lib/server/in-memory-db";
import { handleApiError } from "@/lib/server/api-error";
import { checkRateLimit } from "@/lib/server/rate-limiter";

export const GET = handleApiError(async (req: Request): Promise<NextResponse> => {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(null, ip);
  if (!rl.allowed) return rl.response!;

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
});
