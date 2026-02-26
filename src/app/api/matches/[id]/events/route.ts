import { db } from "@/lib/server/in-memory-db";
import { type GameEvent, MatchStatus } from "@/types";
import { NextRequest } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

function encodeSse(event: GameEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(_request: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  const match = db.getMatch(id);
  if (!match) {
    return new Response(JSON.stringify({ error: "Match not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let pollInterval: ReturnType<typeof setInterval> | undefined;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSeq = 0;

      controller.enqueue(encoder.encode(`: connected ${new Date().toISOString()}\n\n`));

      pollInterval = setInterval(() => {
        if (closed) return;

        const next = db.getEventsSince(id, lastSeq);
        for (const item of next) {
          controller.enqueue(encoder.encode(encodeSse(item.event)));
          lastSeq = item.seq;
        }

        const current = db.getMatch(id);
        if (current?.status === MatchStatus.FINISHED || current?.status === MatchStatus.ARCHIVED) {
          if (pollInterval) clearInterval(pollInterval);
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          closed = true;
          controller.close();
        }
      }, 1000);

      heartbeatInterval = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: keep-alive ${Date.now()}\n\n`));
      }, 5000);
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
