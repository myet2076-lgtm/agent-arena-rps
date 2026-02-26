import { randomBytes, randomUUID } from "node:crypto";
import { type HighlightRound, type Match, type Round, type ShareCard, type ShareEvent } from "@/types";
import { extractHighlights } from "@/lib/share/highlight-extractor";

const BASE_SHARE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://arena.example.com";

export function generateShareToken(): string {
  return randomBytes(12).toString("base64url");
}

export function resolveShareUrl(shareToken: string): string {
  const url = new URL(`/s/${shareToken}`, BASE_SHARE_URL);
  url.searchParams.set("utm_source", "share");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", "match-highlights");
  return url.toString();
}

export function generateShareCard(match: Match, rounds: Round[], highlights?: HighlightRound[]): ShareCard {
  const ranked = highlights ?? extractHighlights(match, rounds);
  const shareToken = generateShareToken();
  const imageUrl = `${BASE_SHARE_URL}/api/og/match/${match.id}?token=${shareToken}`;

  return {
    id: randomUUID(),
    matchId: match.id,
    imageUrl,
    highlightRounds: ranked.slice(0, 3).map((h) => h.roundNo),
    shareToken,
    createdAt: new Date(),
  };
}

export interface ShareEventStore {
  addShareEvent: (event: ShareEvent) => ShareEvent;
}

export function recordShareEvent(
  store: ShareEventStore,
  shareCardId: string,
  viewerId: string | null,
  platform: string,
): ShareEvent {
  const event: ShareEvent = {
    id: randomUUID(),
    shareCardId,
    viewerId,
    platform,
    referralClicks: 1,
    createdAt: new Date(),
  };

  store.addShareEvent(event);
  return event;
}
