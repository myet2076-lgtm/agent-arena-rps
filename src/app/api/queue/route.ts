/**
 * Queue endpoints
 * GET  /api/queue — Public lobby (no auth)
 * POST /api/queue — Join queue (auth required)
 * DELETE /api/queue — Leave queue (auth required)
 */

import { NextResponse } from "next/server";
import { authenticateByKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { joinQueue, leaveQueue, getPublicQueue } from "@/lib/services/queue-service";

export const GET = handleApiError(async (req: Request) => {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(null, ip);
  if (!rl.allowed) return rl.response!;

  return NextResponse.json(getPublicQueue());
});

export const POST = handleApiError(async (req: Request) => {
  const auth = await authenticateByKey(req);
  if (!auth.valid) {
    const apiKey = req.headers.get("x-agent-key");
    throw new ApiError(401, apiKey ? "INVALID_KEY" : "MISSING_KEY", auth.error);
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(auth.agentId, ip);
  if (!rl.allowed) return rl.response!;

  const result = joinQueue(auth.agentId);
  return NextResponse.json(result, { status: 201 });
});

export const DELETE = handleApiError(async (req: Request) => {
  const auth = await authenticateByKey(req);
  if (!auth.valid) {
    const apiKey = req.headers.get("x-agent-key");
    throw new ApiError(401, apiKey ? "INVALID_KEY" : "MISSING_KEY", auth.error);
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(auth.agentId, ip);
  if (!rl.allowed) return rl.response!;

  const result = leaveQueue(auth.agentId);
  return NextResponse.json(result);
});
