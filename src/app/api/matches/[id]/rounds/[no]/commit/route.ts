import { db } from "@/lib/server/in-memory-db";
import { type CommitRequest } from "@/types";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string; no: string }>;
}

const HASH_REGEX = /^[a-f0-9]{64}$/i;

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id, no } = await params;
  const roundNo = Number.parseInt(no, 10);

  if (!Number.isInteger(roundNo) || roundNo <= 0) {
    return NextResponse.json({ error: "Invalid round number" }, { status: 400 });
  }

  const body = (await request.json()) as CommitRequest;
  if (!body?.agentId || !body?.commitHash) {
    return NextResponse.json({ error: "agentId and commitHash are required" }, { status: 400 });
  }

  if (!HASH_REGEX.test(body.commitHash)) {
    return NextResponse.json({ error: "commitHash must be a SHA-256 hex digest" }, { status: 422 });
  }

  const match = db.getMatch(id);
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  if (body.agentId !== match.agentA && body.agentId !== match.agentB) {
    return NextResponse.json({ error: "Unknown agent for match" }, { status: 403 });
  }

  const expectedRound = match.currentRound + 1;
  if (roundNo !== expectedRound) {
    return NextResponse.json({ error: `Expected round ${expectedRound}, got ${roundNo}` }, { status: 400 });
  }

  const existing = db.getCommit(id, roundNo, body.agentId);
  if (existing) {
    return NextResponse.json({ error: "Commit already submitted for this round" }, { status: 409 });
  }

  const commit = db.upsertCommit(id, roundNo, body.agentId, body.commitHash.toLowerCase());

  return NextResponse.json({ commit }, { status: 201 });
}
