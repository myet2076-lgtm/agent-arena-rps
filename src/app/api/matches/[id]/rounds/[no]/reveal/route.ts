import { buildRevealNonce, verifyAndRegisterNonce } from "@/lib/fairness/commit-reveal";
import { processRound } from "@/lib/engine/game-engine";
import { rankingFacade } from "@/lib/ranking";
import { db } from "@/lib/server/in-memory-db";
import { MatchStatus, Move, type RevealRequest } from "@/types";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string; no: string }>;
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id, no } = await params;
  const roundNo = Number.parseInt(no, 10);
  if (!Number.isInteger(roundNo) || roundNo <= 0) {
    return NextResponse.json({ error: "Invalid round number" }, { status: 400 });
  }

  const body = (await request.json()) as RevealRequest;
  if (!body?.agentId || !body?.move || !body?.salt) {
    return NextResponse.json({ error: "agentId, move and salt are required" }, { status: 400 });
  }

  if (!Object.values(Move).includes(body.move)) {
    return NextResponse.json({ error: "Invalid move" }, { status: 400 });
  }

  const match = db.getMatch(id);
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  if (body.agentId !== match.agentA && body.agentId !== match.agentB) {
    return NextResponse.json({ error: "Unknown agent for match" }, { status: 403 });
  }

  const commitA = db.getCommit(id, roundNo, match.agentA);
  const commitB = db.getCommit(id, roundNo, match.agentB);
  if (!commitA || !commitB) {
    return NextResponse.json({ error: "Both agents must commit before revealing" }, { status: 400 });
  }

  const commit = db.getCommit(id, roundNo, body.agentId);
  if (!commit) {
    return NextResponse.json({ error: "Missing commit for reveal" }, { status: 409 });
  }

  db.upsertReveal(id, roundNo, body.agentId, body.move, body.salt);
  const verified = db.verifyReveal(id, roundNo, body.agentId);

  if (!verified) {
    return NextResponse.json({ error: "Reveal hash verification failed" }, { status: 422 });
  }

  const nonce = buildRevealNonce(`${id}:${roundNo}`, body.agentId, body.salt);
  const nonceSet = db.getOrCreateRevealNonceSet(id);
  if (!verifyAndRegisterNonce(nonce, nonceSet)) {
    return NextResponse.json({ error: "Replay detected" }, { status: 409 });
  }

  const revealA = db.getReveal(id, roundNo, match.agentA);
  const revealB = db.getReveal(id, roundNo, match.agentB);

  let round = db.getRound(id, roundNo);
  if (revealA?.verified && revealB?.verified) {
    const existingRound = db.getRound(id, roundNo);
    if (existingRound && (existingRound.phase === "JUDGED" || existingRound.phase === "PUBLISHED")) {
      return NextResponse.json(
        {
          revealVerified: true,
          round: existingRound,
          judged: true,
        },
        { status: 200 },
      );
    }

    const rounds = db.getRounds(id);
    if (roundNo !== rounds.length + 1) {
      return NextResponse.json({ error: "Out-of-order round reveal" }, { status: 409 });
    }

    const result = processRound(match, rounds, revealA.move, revealB.move);
    db.addRound(result.round);
    db.updateMatch(result.updatedMatch);
    db.appendEvents(id, result.events);

    if (result.updatedMatch.status === MatchStatus.FINISHED) {
      try {
        const votes = db.getVotesForMatch(id);
        const rankingResult = await rankingFacade.processMatchResult({
          match: result.updatedMatch,
          votes,
        });
        db.addEloRating(rankingResult.ratings.ratingA);
        db.addEloRating(rankingResult.ratings.ratingB);
      } catch (err) {
        console.error("[reveal] ranking update failed (non-fatal):", err);
      }
    }

    round = result.round;
  }

  return NextResponse.json(
    {
      revealVerified: true,
      round,
      judged: Boolean(round && revealA?.verified && revealB?.verified),
    },
    { status: 200 },
  );
}
