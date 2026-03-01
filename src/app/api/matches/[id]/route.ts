import { db } from "@/lib/server/in-memory-db";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { MatchStatus, RoundPhase } from "@/types";
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

  const allRounds = db.getRounds(id);

  // Only include resolved rounds (PRD F12: no in-progress round data)
  const resolvedRounds = allRounds.filter(
    (r) => r.phase === RoundPhase.JUDGED || r.phase === RoundPhase.PUBLISHED,
  );

  const roundDetails = resolvedRounds.map((r) => ({
    round: r.roundNo,
    moveA: r.moveA,
    moveB: r.moveB,
    winner: r.outcome === "WIN_A" || r.outcome === "FORFEIT_B"
      ? "A"
      : r.outcome === "WIN_B" || r.outcome === "FORFEIT_A"
        ? "B"
        : null,
    predictionBonusA: r.predictionBonusA,
    predictionBonusB: r.predictionBonusB,
    pointsA: r.pointsA,
    pointsB: r.pointsB,
    resolvedAt: r.judgedAt?.toISOString() ?? null,
  }));

  const agentA = db.getAgent(match.agentA);
  const agentB = db.getAgent(match.agentB);
  const votes = db.getVoteTally(id);

  // Build response matching MatchResponseDTO shape for frontend compatibility
  const matchDTO = {
    id: match.id,
    seasonId: match.seasonId,
    agentA: match.agentA,
    agentB: match.agentB,
    agentAName: agentA?.name ?? match.agentA,
    agentBName: agentB?.name ?? match.agentB,
    status: match.status,
    format: match.format,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    winsA: match.winsA,
    winsB: match.winsB,
    currentRound: match.currentRound,
    maxRounds: match.maxRounds,
    winnerId: match.winnerId,
    startedAt: match.startedAt?.toISOString() ?? null,
    finishedAt: match.finishedAt?.toISOString() ?? null,
    createdAt: match.createdAt?.toISOString() ?? null,
    readyA: match.readyA,
    readyB: match.readyB,
    readyDeadline: match.readyDeadline?.toISOString() ?? null,
    currentPhase: match.currentPhase,
    phaseDeadline: match.phaseDeadline?.toISOString() ?? null,
    eloChangeA: match.eloChangeA,
    eloChangeB: match.eloChangeB,
    eloUpdatedAt: match.eloUpdatedAt?.toISOString() ?? null,
  };

  if (match.status === MatchStatus.FINISHED) {
    const eloChanges: Record<string, number> = {};
    if (agentA && match.eloChangeA != null) eloChanges[agentA.id] = match.eloChangeA;
    if (agentB && match.eloChangeB != null) eloChanges[agentB.id] = match.eloChangeB;

    return NextResponse.json({
      match: matchDTO,
      rounds: roundDetails,
      market: db.getMarket(id) ?? null,
      votes,
      eloChanges,
      eloUpdatedAt: match.eloUpdatedAt?.toISOString() ?? null,
    });
  }

  return NextResponse.json({
    match: matchDTO,
    rounds: roundDetails,
    market: db.getMarket(id) ?? null,
    votes,
  });
});
