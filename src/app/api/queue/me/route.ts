/**
 * GET /api/queue/me — Check position + heartbeat
 */

import { NextResponse } from "next/server";
import { authenticateByKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { checkPosition } from "@/lib/services/queue-service";

export const GET = handleApiError(async (req: Request) => {
  const auth = authenticateByKey(req);
  if (!auth.valid) throw new ApiError(401, "UNAUTHORIZED", auth.error);

  const result = checkPosition(auth.agentId);
  return NextResponse.json(result);
});
