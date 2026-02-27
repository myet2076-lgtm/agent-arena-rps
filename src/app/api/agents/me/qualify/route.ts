/**
 * POST /api/agents/me/qualify — Start qualification match
 */

import { NextResponse } from "next/server";
import { authenticateByKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { startQualification } from "@/lib/services/qual-service";
import type { QualDifficulty } from "@/types";

export const POST = handleApiError(async (req: Request) => {
  const auth = await authenticateByKey(req);
  if (!auth.valid) {
    const apiKey = req.headers.get("x-agent-key");
    throw new ApiError(401, apiKey ? "INVALID_KEY" : "MISSING_KEY", auth.error);
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(auth.agentId, ip);
  if (!rl.allowed) return rl.response!;

  const body = await req.json().catch(() => ({}));
  const difficulty = (body.difficulty ?? "easy") as QualDifficulty;
  if (!["easy", "medium", "hard"].includes(difficulty)) {
    throw new ApiError(400, "BAD_REQUEST", "difficulty must be easy, medium, or hard");
  }

  const result = startQualification(auth.agentId, difficulty);
  return NextResponse.json(result, { status: 200 });
});
