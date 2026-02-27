import { voteService, DuplicateVoteError } from "@/lib/market";
import { db } from "@/lib/server/in-memory-db";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { type Vote, MatchStatus } from "@/types";
import { ApiError, handleApiError } from "@/lib/server/api-error";
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

  const tally = await voteService.getVoteTally(id);
  return NextResponse.json({ tally, votes: db.getVotes(id) }, { status: 200 });
});

export const POST = handleApiError(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(null, ip);
  if (!rl.allowed) return rl.response!;

  const { id } = await params;
  const match = db.getMatch(id);
  if (!match) throw new ApiError(404, "NOT_FOUND", "Match not found");

  if (match.status === MatchStatus.FINISHED || match.status === MatchStatus.ARCHIVED) {
    throw new ApiError(400, "BAD_REQUEST", "Match already finished");
  }

  const body = await req.json().catch(() => null);
  if (!body) throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body");

  const parsedBody = body as Partial<Pick<Vote, "viewerId" | "side" | "roundNo">>;

  if (!parsedBody.viewerId || (parsedBody.side !== "A" && parsedBody.side !== "B")) {
    throw new ApiError(400, "BAD_REQUEST", "viewerId and side(A|B) are required");
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
      throw new ApiError(409, "ALREADY_IN_QUEUE", error.message);
    }
    throw error;
  }
});
