import { authenticateByKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { db } from "@/lib/server/in-memory-db";
import { type GameEvent, MatchStatus } from "@/types";
import { NextRequest } from "next/server";

const MAX_BUFFER = 50;

interface Params {
  params: Promise<{ id: string }>;
}

type Perspective = "agent" | "viewer";

function formatEventForPerspective(
  event: GameEvent,
  perspective: Perspective,
  agentId: string | null,
  matchAgentA: string,
  matchAgentB: string,
): Record<string, unknown> {
  if (event.type === "ROUND_RESULT") {
    if (perspective === "agent" && agentId) {
      const isA = agentId === matchAgentA;
      const yourMove = isA ? event.moveA : event.moveB;
      const opponentMove = isA ? event.moveB : event.moveA;
      const yourPredictionBonus = isA ? event.predictionBonusA : event.predictionBonusB;
      return {
        type: event.type,
        round: event.roundNo,
        yourMove,
        opponentMove,
        result: event.outcome,
        prediction: { yours: null, hit: yourPredictionBonus ?? false },
        score: { you: isA ? event.scoreA : event.scoreB, opponent: isA ? event.scoreB : event.scoreA },
      };
    }
    // Viewer
    return {
      type: event.type,
      round: event.roundNo,
      moveA: event.moveA ?? null,
      moveB: event.moveB ?? null,
      winner: event.winner ?? null,
      predictionBonusA: event.predictionBonusA ?? false,
      predictionBonusB: event.predictionBonusB ?? false,
      scoreA: event.scoreA,
      scoreB: event.scoreB,
    };
  }

  if (event.type === "MATCH_FINISHED") {
    if (perspective === "agent" && agentId) {
      const isA = agentId === matchAgentA;
      return {
        type: event.type,
        winner: event.winnerId,
        finalScore: {
          you: isA ? event.finalScoreA : event.finalScoreB,
          opponent: isA ? event.finalScoreB : event.finalScoreA,
        },
        eloChange: isA ? (event.eloChangeA ?? 0) : (event.eloChangeB ?? 0),
      };
    }
    return {
      type: event.type,
      winner: event.winnerId,
      finalScoreA: event.finalScoreA,
      finalScoreB: event.finalScoreB,
    };
  }

  // All other events: same for both perspectives
  return event as unknown as Record<string, unknown>;
}

function encodeSse(matchId: string, seq: number, event: Record<string, unknown>): string {
  const type = event.type as string;
  return `id: ${matchId}-${seq}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function buildResyncSnapshot(
  matchId: string,
  perspective: Perspective,
  agentId: string | null,
  matchAgentA: string,
  matchAgentB: string,
): Record<string, unknown> {
  const currentMatch = db.getMatch(matchId);
  if (!currentMatch) {
    return { type: "RESYNC", matchId, snapshot: {} };
  }

  const baseSnapshot: Record<string, unknown> = {
    status: currentMatch.status,
    phase: currentMatch.currentPhase,
    currentRound: currentMatch.currentRound,
  };

  if (perspective === "agent" && agentId) {
    const isA = agentId === matchAgentA;
    baseSnapshot.score = {
      you: isA ? currentMatch.scoreA : currentMatch.scoreB,
      opponent: isA ? currentMatch.scoreB : currentMatch.scoreA,
    };
  } else {
    baseSnapshot.scoreA = currentMatch.scoreA;
    baseSnapshot.scoreB = currentMatch.scoreB;
  }

  return { type: "RESYNC", matchId, snapshot: baseSnapshot };
}

export const GET = handleApiError(async (request: NextRequest, { params }: Params) => {
  const { id: matchId } = await params;

  // Rate limit: authenticated by key if present, otherwise by IP
  const apiKey = request.headers.get("x-agent-key");
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  let authedAgentId: string | null = null;

  if (apiKey) {
    const auth = authenticateByKey(request);
    if (!auth.valid) {
      throw new ApiError(401, "INVALID_KEY", "Invalid API key");
    }
    const rl = checkRateLimit(auth.agentId, ip);
    if (!rl.allowed) return rl.response!;
    authedAgentId = auth.agentId;
  } else {
    const rl = checkRateLimit(null, ip);
    if (!rl.allowed) return rl.response!;
  }

  const match = db.getMatch(matchId);
  if (!match) {
    throw new ApiError(404, "NOT_FOUND", "Match not found");
  }

  // Auth-based perspective
  let perspective: Perspective = "viewer";
  let agentId: string | null = null;

  if (authedAgentId && (authedAgentId === match.agentA || authedAgentId === match.agentB)) {
    perspective = "agent";
    agentId = authedAgentId;
  }

  // Parse Last-Event-ID — format: {matchId}-{seq}
  const lastEventId = request.headers.get("last-event-id");
  let startSeq = 0;
  let needsResyncCheck = false;
  if (lastEventId) {
    // Validate format: must belong to this match
    const prefix = `${matchId}-`;
    if (lastEventId.startsWith(prefix)) {
      const seq = parseInt(lastEventId.slice(prefix.length), 10);
      if (!isNaN(seq) && seq > 0) {
        startSeq = seq;
        needsResyncCheck = true;
      }
    }
    // If format doesn't match this matchId, ignore and send full snapshot (RESYNC path)
    if (!needsResyncCheck && lastEventId.length > 0) {
      needsResyncCheck = true; // will trigger RESYNC since startSeq=0 < oldestSeq
    }
  }

  const encoder = new TextEncoder();
  let closed = false;
  let closeScheduled = false;
  let closeTimeout: ReturnType<typeof setTimeout> | undefined;
  let pollInterval: ReturnType<typeof setInterval> | undefined;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSeq = startSeq;

      controller.enqueue(encoder.encode(`: connected ${new Date().toISOString()}\n\n`));

      // Replay from buffer or send RESYNC
      if (needsResyncCheck) {
        const oldestSeq = db.getOldestSeq(matchId);
        if (startSeq < oldestSeq) {
          // Client is too far behind — send RESYNC with perspective-aware snapshot
          const snapshot = buildResyncSnapshot(matchId, perspective, agentId, match.agentA, match.agentB);
          controller.enqueue(encoder.encode(encodeSse(matchId, 0, snapshot)));
          // Update lastSeq to current oldest so polling picks up from there
          const allBuffered = db.getEventsSince(matchId, 0);
          if (allBuffered.length > 0) lastSeq = allBuffered[allBuffered.length - 1].seq;
        } else {
          // Replay events from lastSeenSeq+1
          const buffered = db.getEventsSince(matchId, startSeq);
          for (const item of buffered) {
            const formatted = formatEventForPerspective(item.event, perspective, agentId, match.agentA, match.agentB);
            controller.enqueue(encoder.encode(encodeSse(matchId, item.seq, formatted)));
            lastSeq = item.seq;
          }
        }
      } else {
        // No Last-Event-ID — send current state snapshot then stream
        const currentMatch = db.getMatch(matchId);
        if (currentMatch) {
          const snapshot: Record<string, unknown> = {
            type: "STATE_SNAPSHOT",
            matchId,
            snapshot: {
              status: currentMatch.status,
              phase: currentMatch.currentPhase,
              scoreA: currentMatch.scoreA,
              scoreB: currentMatch.scoreB,
              currentRound: currentMatch.currentRound,
            },
          };
          controller.enqueue(encoder.encode(encodeSse(matchId, 0, snapshot)));
        }
        // Also replay any existing buffered events
        const buffered = db.getEventsSince(matchId, 0);
        for (const item of buffered) {
          const formatted = formatEventForPerspective(item.event, perspective, agentId, match.agentA, match.agentB);
          controller.enqueue(encoder.encode(encodeSse(matchId, item.seq, formatted)));
          lastSeq = item.seq;
        }
      }

      pollInterval = setInterval(() => {
        if (closed) return;

        const next = db.getEventsSince(matchId, lastSeq);
        for (const item of next) {
          const formatted = formatEventForPerspective(item.event, perspective, agentId, match.agentA, match.agentB);
          controller.enqueue(encoder.encode(encodeSse(matchId, item.seq, formatted)));
          lastSeq = item.seq;
        }

        const current = db.getMatch(matchId);
        if ((current?.status === MatchStatus.FINISHED || current?.status === MatchStatus.ARCHIVED) && !closeScheduled) {
          closeScheduled = true;
          closeTimeout = setTimeout(() => {
            if (pollInterval) clearInterval(pollInterval);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            closed = true;
            try { controller.close(); } catch { /* already closed */ }
          }, 5000);
        }
      }, 500);

      heartbeatInterval = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
      }, 15000);
    },
    cancel() {
      if (pollInterval) clearInterval(pollInterval);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (closeTimeout) clearTimeout(closeTimeout);
      closed = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  }) as any; // SSE Response compatible with handleApiError wrapper
});
