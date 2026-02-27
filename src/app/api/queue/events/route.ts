/**
 * GET /api/queue/events — Queue SSE stream
 */

import { authenticateByKey } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/api-error";
import { subscribeQueueEvents } from "@/lib/services/queue-events";
import { db } from "@/lib/server/in-memory-db";

export async function GET(req: Request): Promise<Response> {
  const auth = authenticateByKey(req);
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED", message: auth.error }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const agentId = auth.agentId;
  const entry = db.getQueueEntryByAgent(agentId);
  if (!entry) {
    return new Response(JSON.stringify({ error: "NOT_IN_QUEUE", message: "Agent is not in queue" }), {
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
        send(`data: ${JSON.stringify(event)}\n\n`);
        // Update lastActivityAt
        const e = db.getQueueEntryByAgent(agentId);
        if (e) {
          e.lastActivityAt = new Date();
          db.updateQueueEntry(e);
        }
      });

      // 15s heartbeat
      const heartbeat = setInterval(() => {
        send(": heartbeat\n\n");
        const e = db.getQueueEntryByAgent(agentId);
        if (e) {
          e.lastActivityAt = new Date();
          db.updateQueueEntry(e);
        }
      }, 15_000);

      // Cleanup on abort
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
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
}
