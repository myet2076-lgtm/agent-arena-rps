// TODO: Replace direct db access with ShareService when available
import { db } from "@/lib/server/in-memory-db";
import { extractHighlights } from "@/lib/share/highlight-extractor";
import { generateShareCard, recordShareEvent, resolveShareUrl, type ShareEventStore } from "@/lib/share/share-card";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const card = db.getShareCard(id);
  if (!card) return NextResponse.json({ error: "Share card not found" }, { status: 404 });

  const viewerId = request.nextUrl.searchParams.get("viewerId");
  const platform = request.nextUrl.searchParams.get("platform");
  if (platform) {
    recordShareEvent(db as ShareEventStore, card.id, viewerId, platform);
  }

  return NextResponse.json({ card, url: resolveShareUrl(card.shareToken) }, { status: 200 });
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;

  const hasBody = (request.headers.get("content-length") ?? "0") !== "0";
  if (hasBody) {
    try {
      await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const match = db.getMatch(id);
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  const rounds = db.getRounds(id);
  const highlights = extractHighlights(match, rounds);
  const card = generateShareCard(match, rounds, highlights);
  db.setShareCard(id, card);

  return NextResponse.json({ card, url: resolveShareUrl(card.shareToken) }, { status: 201 });
}
