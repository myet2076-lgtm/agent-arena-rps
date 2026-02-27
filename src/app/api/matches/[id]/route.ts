import { db } from "@/lib/server/in-memory-db";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { MatchStatus } from "@/types";
import { NextResponse } from "next/server";

export const GET = handleApiError(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(null, ip);
  if (!rl.allowed) return rl.response!;

  const { id } = await params;
  const match = db.getMatch(id);
  if (!match) throw new ApiError(404, "NOT_FOUND", "Match not found");

  if (match.status === MatchStatus.FINISHED) {
    const rounds = db.getRounds(id);
    const agentA = db.getAgent(match.agentA);
    const agentB = db.getAgent(match.agentB);

    const roundDetails = rounds.map((r) => ({
      round: r.roundNo,
      moveA: r.moveA,
      moveB: r.moveB,
      winner: r.outcome === "WIN_A" || r.outcome === "FORFEIT_B"
        ? "A"
        : r.outcome === "WIN_B" || r.outcome === "FORFEIT_A"
          ? "B"
          : r.outcome === "DRAW"
            ? null
            : null,
      predictionBonusA: r.predictionBonusA,
      predictionBonusB: r.predictionBonusB,
      scoreAfter: { A: 0, B: 0 },
    }));

    let cumA = 0;
    let cumB = 0;
    for (const rd of roundDetails) {
      const srcRound = rounds.find((r) => r.roundNo === rd.round)!;
      cumA += srcRound.pointsA;
      cumB += srcRound.pointsB;
      rd.scoreAfter = { A: cumA, B: cumB };
    }

    const eloChanges: Record<string, number> = {};
    if (agentA && match.eloChangeA != null) eloChanges[agentA.name] = match.eloChangeA;
    if (agentB && match.eloChangeB != null) eloChanges[agentB.name] = match.eloChangeB;

    return NextResponse.json({
      matchId: match.id,
      agentA: match.agentA,
      agentB: match.agentB,
      status: "FINISHED",
      winner: match.winnerId,
      finalScore: { A: match.scoreA, B: match.scoreB },
      rounds: roundDetails,
      eloChanges,
      eloUpdatedAt: match.eloUpdatedAt,
      startedAt: match.startedAt,
      finishedAt: match.finishedAt,
      totalRounds: rounds.length,
    }, { status: 200 });
  }

  const response = {
    matchId: match.id,
    agentA: match.agentA,
    agentB: match.agentB,
    status: match.status,
    format: match.format,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    currentRound: match.currentRound,
    maxRounds: match.maxRounds,
    currentPhase: match.currentPhase,
    startedAt: match.startedAt,
    createdAt: match.createdAt,
    market: db.getMarket(id),
    votes: db.getVoteTally(id),
  };

  return NextResponse.json(response, { status: 200 });
});
