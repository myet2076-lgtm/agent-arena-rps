/**
 * POST /api/agents/me/qualify — Start qualification match
 */

import { NextResponse } from "next/server";
import { authenticateByKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { startQualification } from "@/lib/services/qual-service";
import type { QualDifficulty } from "@/types";

export const POST = handleApiError(async (req: Request) => {
  const auth = authenticateByKey(req);
  if (!auth.valid) {
    const apiKey = req.headers.get("x-agent-key");
    throw new ApiError(401, apiKey ? "INVALID_KEY" : "MISSING_KEY", auth.error);
  }

  const url = new URL(req.url);
  const difficulty = (url.searchParams.get("difficulty") ?? "easy") as QualDifficulty;
  if (!["easy", "medium", "hard"].includes(difficulty)) {
    throw new ApiError(400, "INVALID_DIFFICULTY", "difficulty must be easy, medium, or hard");
  }

  const result = startQualification(auth.agentId, difficulty);
  return NextResponse.json(result, { status: 201 });
});
