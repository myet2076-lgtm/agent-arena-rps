/**
 * GET /api/queue/events — Queue SSE stream (PRD F08)
 */

import { authenticateByKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { subscribeQueueEvents, toQueueSsePayload } from "@/lib/services/queue-events";
import { db } from "@/lib/server/in-memory-db";
import { AgentStatus } from "@/types";

export const GET = handleApiError(async (req: Request) => {
  const auth = authenticateByKey(req);
  if (!auth.valid) {
    const apiKey = req.headers.get("x-agent-key");
    throw new ApiError(401, apiKey ? "INVALID_KEY" : "MISSING_KEY", auth.error);
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(auth.agentId, ip);
  if (!rl.allowed) return rl.response!;

  const agentId = auth.agentId;
  const agent = db.getAgent(agentId);
  if (!agent) throw new ApiError(401, "INVALID_KEY", "Invalid API key");
  if (agent.status !== AgentStatus.QUALIFIED && agent.status !== AgentStatus.QUEUED && agent.status !== AgentStatus.MATCHED) {
    throw new ApiError(403, "NOT_QUALIFIED", `Agent status is ${agent.status}, must be QUALIFIED/QUEUED/MATCHED`);
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // stream closed
        }
      };

      const sendEvent = (eventType: "POSITION_UPDATE" | "MATCH_ASSIGNED" | "REMOVED", payload: object) => {
        send(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
      };

      const touchHeartbeat = () => {
        const e = db.getActiveQueueEntryByAgent(agentId);
        if (e) {
          e.lastSSEPing = new Date();
          e.lastActivityAt = new Date();
          e.sseDisconnectedAt = null;
          db.updateQueueEntry(e);
        }
      };

      // Send snapshot-on-connect semantics (PRD F08 queue SSE reconnect behavior)
      const activeEntry = db.getActiveQueueEntryByAgent(agentId);
      if (activeEntry?.status === "WAITING") {
        const waiting = db.listQueueEntries("WAITING");
        const idx = waiting.findIndex((e) => e.id === activeEntry.id);
        const position = idx >= 0 ? idx + 1 : waiting.length + 1;
        sendEvent("POSITION_UPDATE", { position, estimatedWaitSec: position * 30 });
      } else if (activeEntry?.status === "MATCHED") {
        const matches = db.listMatches();
        const match = matches.find((m) => (m.agentA === agentId || m.agentB === agentId) && m.currentPhase === "READY_CHECK");
        if (match) {
          const opponentId = match.agentA === agentId ? match.agentB : match.agentA;
          const opponent = db.getAgent(opponentId);
          sendEvent("MATCH_ASSIGNED", {
            matchId: match.id,
            opponent: { id: opponentId, name: opponent?.name ?? "Unknown", elo: opponent?.elo ?? 1500 },
            readyDeadline: match.readyDeadline?.toISOString() ?? new Date().toISOString(),
          });
        }
      } else if (agent.status === AgentStatus.QUALIFIED) {
        sendEvent("REMOVED", { reason: "MANUAL" });
      }
      touchHeartbeat();

      // Subscribe to events
      const unsubscribe = subscribeQueueEvents(agentId, (event) => {
        sendEvent(event.type, toQueueSsePayload(event));
        touchHeartbeat();
      });

      // 15s heartbeat (implicit SSE heartbeat)
      const heartbeat = setInterval(() => {
        send(": heartbeat\n\n");
        touchHeartbeat();
      }, 15_000);

      // Cleanup on abort — mark SSE disconnect time for grace period
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        const e = db.getActiveQueueEntryByAgent(agentId);
        if (e) {
          e.sseDisconnectedAt = new Date();
          db.updateQueueEntry(e);
        }
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  }) as any; // SSE Response compatible with handleApiError wrapper
});
