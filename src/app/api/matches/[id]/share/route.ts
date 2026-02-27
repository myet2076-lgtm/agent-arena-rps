import { db } from "@/lib/server/in-memory-db";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { extractHighlights } from "@/lib/share/highlight-extractor";
import { generateShareCard, recordShareEvent, resolveShareUrl, type ShareEventStore } from "@/lib/share/share-card";
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
  const card = db.getShareCard(id);
  if (!card) throw new ApiError(404, "NOT_FOUND", "Share card not found");

  const url = new URL(req.url);
  const viewerId = url.searchParams.get("viewerId");
  const platform = url.searchParams.get("platform");
  if (platform) {
    recordShareEvent(db as ShareEventStore, card.id, viewerId, platform);
  }

  return NextResponse.json({ card, url: resolveShareUrl(card.shareToken) }, { status: 200 });
});

export const POST = handleApiError(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(null, ip);
  if (!rl.allowed) return rl.response!;

  const { id } = await params;

  const hasBody = (req.headers.get("content-length") ?? "0") !== "0";
  if (hasBody) {
    try {
      await req.json();
    } catch {
      throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body");
    }
  }

  const match = db.getMatch(id);
  if (!match) throw new ApiError(404, "NOT_FOUND", "Match not found");

  const rounds = db.getRounds(id);
  const highlights = extractHighlights(match, rounds);
  const card = generateShareCard(match, rounds, highlights);
  db.setShareCard(id, card);

  return NextResponse.json({ card, url: resolveShareUrl(card.shareToken) }, { status: 201 });
});
