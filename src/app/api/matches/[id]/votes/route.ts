import { voteService, DuplicateVoteError } from "@/lib/market";
import { db } from "@/lib/server/in-memory-db";
import { type Vote, MatchStatus } from "@/types";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const match = db.getMatch(id);
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  const tally = await voteService.getVoteTally(id);
  return NextResponse.json({ tally, votes: db.getVotes(id) }, { status: 200 });
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const match = db.getMatch(id);
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  if (match.status === MatchStatus.FINISHED || match.status === MatchStatus.ARCHIVED) {
    return NextResponse.json({ error: "Match already finished" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedBody = body as Partial<Pick<Vote, "viewerId" | "side" | "roundNo">>;

  if (!parsedBody.viewerId || (parsedBody.side !== "A" && parsedBody.side !== "B")) {
    return NextResponse.json({ error: "viewerId and side(A|B) are required" }, { status: 400 });
  }

  try {
    const vote = await voteService.castVote(
      id,
      parsedBody.viewerId,
      parsedBody.side,
      typeof parsedBody.roundNo === "number" ? parsedBody.roundNo : null,
    );
    const tally = await voteService.getVoteTally(id);

    return NextResponse.json({ vote, tally }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateVoteError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    throw error;
  }
}
