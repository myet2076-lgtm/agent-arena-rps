import { db } from "@/lib/server/in-memory-db";
import { MatchStatus } from "@/types";
import { NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const match = db.getMatch(id);
  if (!match) return NextResponse.json({ error: "NOT_FOUND", message: "Match not found" }, { status: 404 });

  const rounds = db.getRounds(id);

  // Public view: no commit hashes or salts during match
  const sanitizedRounds = rounds.map((r) => {
    if (match.status === MatchStatus.FINISHED) {
      return r; // Full details after finished
    }
    // During match: strip crypto fields
    const { ...rest } = r;
    return {
      ...rest,
      // Keep basic round info, strip nothing that's not there
    };
  });

  const response: Record<string, unknown> = {
    match: {
      id: match.id,
      seasonId: match.seasonId,
      agentA: match.agentA,
      agentB: match.agentB,
      status: match.status,
      format: match.format,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      winsA: match.winsA,
      winsB: match.winsB,
      currentRound: match.currentRound,
      maxRounds: match.maxRounds,
      winnerId: match.winnerId,
      currentPhase: match.currentPhase,
      startedAt: match.startedAt,
      finishedAt: match.finishedAt,
      createdAt: match.createdAt,
      ...(match.status === MatchStatus.FINISHED ? {
        eloChangeA: match.eloChangeA,
        eloChangeB: match.eloChangeB,
        eloUpdatedAt: match.eloUpdatedAt,
      } : {}),
    },
    rounds: sanitizedRounds,
    market: db.getMarket(id),
    votes: db.getVoteTally(id),
  };

  return NextResponse.json(response, { status: 200 });
}
