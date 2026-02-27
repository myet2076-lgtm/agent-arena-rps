/**
 * GET /api/queue/events — Queue SSE stream (PRD F08)
 */

import { authenticateByKey } from "@/lib/server/auth";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { subscribeQueueEvents } from "@/lib/services/queue-events";
import { db } from "@/lib/server/in-memory-db";

export async function GET(req: Request): Promise<Response> {
  try {
    const auth = authenticateByKey(req);
    if (!auth.valid) {
      const apiKey = req.headers.get("x-agent-key");
      return new Response(JSON.stringify({ error: apiKey ? "INVALID_KEY" : "MISSING_KEY", message: auth.error, details: {} }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    const rl = checkRateLimit(auth.agentId, ip);
    if (!rl.allowed) return new Response(rl.response!.body, { status: 429, headers: Object.fromEntries(rl.response!.headers.entries()) });

    const agentId = auth.agentId;
    const entry = db.getQueueEntryByAgent(agentId);
    if (!entry) {
      return new Response(JSON.stringify({ error: "NOT_IN_QUEUE", message: "Agent is not in queue", details: {} }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
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

        // Subscribe to events
        const unsubscribe = subscribeQueueEvents(agentId, (event) => {
          send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          // Update lastSSEPing
          const e = db.getQueueEntryByAgent(agentId);
          if (e) {
            e.lastSSEPing = new Date();
            e.lastActivityAt = new Date();
            e.sseDisconnectedAt = null;
            db.updateQueueEntry(e);
          }
        });

        // 15s heartbeat (implicit SSE heartbeat)
        const heartbeat = setInterval(() => {
          send(": heartbeat\n\n");
          const e = db.getQueueEntryByAgent(agentId);
          if (e) {
            e.lastSSEPing = new Date();
            e.lastActivityAt = new Date();
            e.sseDisconnectedAt = null;
            db.updateQueueEntry(e);
          }
        }, 15_000);

        // Cleanup on abort — mark SSE disconnect time for grace period
        req.signal.addEventListener("abort", () => {
          unsubscribe();
          clearInterval(heartbeat);
          // Mark SSE disconnect for grace period
          const e = db.getQueueEntryByAgent(agentId);
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
    });
  } catch (err: unknown) {
    console.error("[Queue SSE Error]", err);
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message: "An unexpected error occurred", details: {} }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
