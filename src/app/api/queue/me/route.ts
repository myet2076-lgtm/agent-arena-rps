/**
 * GET /api/queue/me — Check position + heartbeat
 */

import { NextResponse } from "next/server";
import { authenticateByKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { checkPosition } from "@/lib/services/queue-service";

export const GET = handleApiError(async (req: Request) => {
  const auth = authenticateByKey(req);
  if (!auth.valid) {
    const apiKey = req.headers.get("x-agent-key");
    throw new ApiError(401, apiKey ? "INVALID_KEY" : "MISSING_KEY", auth.error);
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(auth.agentId, ip);
  if (!rl.allowed) return rl.response!;

  const result = checkPosition(auth.agentId);
  return NextResponse.json(result);
});
