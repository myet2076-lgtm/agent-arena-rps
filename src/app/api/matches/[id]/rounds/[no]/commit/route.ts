import { checkMatchWinner } from "@/lib/engine";
import { handleTimeout } from "@/lib/fairness/timeout";
import { db } from "@/lib/server/in-memory-db";
import { MatchStatus, type CommitRequest, type Match, type Round, RoundOutcome } from "@/types";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string; no: string }>;
}

const HASH_REGEX = /^[a-f0-9]{64}$/i;

function persistTimeoutResult(match: Match, round: Round): Match {
  const winsAInc = round.outcome === RoundOutcome.WIN_A || round.outcome === RoundOutcome.FORFEIT_B ? 1 : 0;
  const winsBInc = round.outcome === RoundOutcome.WIN_B || round.outcome === RoundOutcome.FORFEIT_A ? 1 : 0;

  const progressedMatch: Match = {
    ...match,
    status: match.status === MatchStatus.CREATED ? MatchStatus.RUNNING : match.status,
    scoreA: match.scoreA + round.pointsA,
    scoreB: match.scoreB + round.pointsB,
    winsA: match.winsA + winsAInc,
    winsB: match.winsB + winsBInc,
    currentRound: round.roundNo,
  };

  const winnerId = checkMatchWinner(progressedMatch);
  if (!winnerId) {
    return progressedMatch;
  }

  return {
    ...progressedMatch,
    status: MatchStatus.FINISHED,
    winnerId: winnerId === "DRAW" ? null : winnerId,
    finishedAt: new Date(),
  };
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id, no } = await params;
  const roundNo = Number.parseInt(no, 10);

  if (!Number.isInteger(roundNo) || roundNo <= 0) {
    return NextResponse.json({ error: "Invalid round number" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedBody = body as CommitRequest;
  if (!parsedBody?.agentId || !parsedBody?.commitHash) {
    return NextResponse.json({ error: "agentId and commitHash are required" }, { status: 400 });
  }

  if (!HASH_REGEX.test(parsedBody.commitHash)) {
    return NextResponse.json({ error: "commitHash must be a SHA-256 hex digest" }, { status: 422 });
  }

  const match = db.getMatch(id);
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  if (parsedBody.agentId !== match.agentA && parsedBody.agentId !== match.agentB) {
    return NextResponse.json({ error: "Unknown agent for match" }, { status: 403 });
  }

  const expectedRound = match.currentRound + 1;
  if (roundNo !== expectedRound) {
    return NextResponse.json({ error: `Expected round ${expectedRound}, got ${roundNo}` }, { status: 400 });
  }

  const existing = db.getCommit(id, roundNo, parsedBody.agentId);
  if (existing) {
    return NextResponse.json({ error: "Commit already submitted for this round" }, { status: 409 });
  }

  const otherAgentId = parsedBody.agentId === match.agentA ? match.agentB : match.agentA;
  const otherCommit = db.getCommit(id, roundNo, otherAgentId);
  if (otherCommit && new Date().getTime() > otherCommit.expiresAt.getTime()) {
    const timeout = handleTimeout(id, roundNo, parsedBody.agentId, match.scoreA, match.scoreB);
    db.addRound(timeout.round);
    db.appendEvents(id, timeout.events);
    const updatedMatch = persistTimeoutResult(match, timeout.round);
    db.updateMatch(updatedMatch);

    return NextResponse.json(
      { timeout: true, forfeitedAgentId: parsedBody.agentId, round: timeout.round, match: updatedMatch },
      { status: 200 },
    );
  }

  const commit = db.upsertCommit(id, roundNo, parsedBody.agentId, parsedBody.commitHash.toLowerCase());

  return NextResponse.json({ commit }, { status: 201 });
}
