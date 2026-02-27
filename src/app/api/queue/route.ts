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
  const auth = authenticateByKey(req);
  if (!auth.valid) throw new ApiError(401, "UNAUTHORIZED", auth.error);

  const result = joinQueue(auth.agentId);
  return NextResponse.json(result, { status: 201 });
});

export const DELETE = handleApiError(async (req: Request) => {
  const auth = authenticateByKey(req);
  if (!auth.valid) throw new ApiError(401, "UNAUTHORIZED", auth.error);

  const result = leaveQueue(auth.agentId);
  return NextResponse.json(result);
});
