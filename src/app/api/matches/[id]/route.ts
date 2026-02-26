import { db } from "@/lib/server/in-memory-db";
import { type MatchResponse } from "@/types";
import { NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse<MatchResponse | { error: string }>> {
  const { id } = await params;
  const match = db.getMatch(id);
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  const response: MatchResponse = {
    match,
    rounds: db.getRounds(id),
    market: db.getMarket(id),
    votes: db.getVoteTally(id),
  };

  return NextResponse.json(response, { status: 200 });
}
