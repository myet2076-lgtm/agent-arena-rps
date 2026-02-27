import { authenticateByKey } from "@/lib/server/auth";
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
      const opponentPredictionBonus = isA ? event.predictionBonusB : event.predictionBonusA;
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
        eloChange: isA ? event.eloChangeA : event.eloChangeB,
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

function encodeSse(id: string, event: Record<string, unknown>): string {
  const type = event.type as string;
  return `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  const { id: matchId } = await params;

  const match = db.getMatch(matchId);
  if (!match) {
    return new Response(JSON.stringify({ error: "NOT_FOUND", message: "Match not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  // Auth-based perspective
  let perspective: Perspective = "viewer";
  let agentId: string | null = null;

  const apiKey = request.headers.get("x-agent-key");
  if (apiKey) {
    const auth = authenticateByKey(request);
    if (!auth.valid) {
      return new Response(JSON.stringify({ error: "INVALID_KEY", message: "Invalid API key" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    if (auth.agentId === match.agentA || auth.agentId === match.agentB) {
      perspective = "agent";
      agentId = auth.agentId;
    }
  }

  // Parse Last-Event-ID
  const lastEventId = request.headers.get("last-event-id");
  let startSeq = 0;
  if (lastEventId) {
    const parts = lastEventId.split("-");
    if (parts.length === 2 && parts[0] === matchId) {
      const seq = parseInt(parts[1], 10);
      if (!isNaN(seq)) startSeq = seq;
    }
  }

  const encoder = new TextEncoder();
  let closed = false;
  let pollInterval: ReturnType<typeof setInterval> | undefined;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSeq = startSeq;

      controller.enqueue(encoder.encode(`: connected ${new Date().toISOString()}\n\n`));

      // Replay from buffer if needed
      const buffered = db.getEventsSince(matchId, startSeq);
      if (startSeq > 0 && buffered.length === 0) {
        // Buffer overflow → send RESYNC
        const currentMatch = db.getMatch(matchId);
        if (currentMatch) {
          const snapshot: Record<string, unknown> = {
            type: "RESYNC",
            matchId,
            snapshot: {
              status: currentMatch.status,
              phase: currentMatch.currentPhase,
              scoreA: currentMatch.scoreA,
              scoreB: currentMatch.scoreB,
              currentRound: currentMatch.currentRound,
            },
          };
          controller.enqueue(encoder.encode(encodeSse(`${matchId}-0`, snapshot)));
        }
      } else {
        // Replay buffered events
        for (const item of buffered.slice(-MAX_BUFFER)) {
          const formatted = formatEventForPerspective(item.event, perspective, agentId, match.agentA, match.agentB);
          controller.enqueue(encoder.encode(encodeSse(`${matchId}-${item.seq}`, formatted)));
          lastSeq = item.seq;
        }
      }

      pollInterval = setInterval(() => {
        if (closed) return;

        const next = db.getEventsSince(matchId, lastSeq);
        for (const item of next) {
          const formatted = formatEventForPerspective(item.event, perspective, agentId, match.agentA, match.agentB);
          controller.enqueue(encoder.encode(encodeSse(`${matchId}-${item.seq}`, formatted)));
          lastSeq = item.seq;
        }

        const current = db.getMatch(matchId);
        if (current?.status === MatchStatus.FINISHED || current?.status === MatchStatus.ARCHIVED) {
          // Close after 5s
          setTimeout(() => {
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
  });
}
