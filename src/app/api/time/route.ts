/**
 * GET /api/time — Server time (PRD F06)
 */

import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/server/rate-limiter";


export async function GET(req: Request): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(null, ip);
  if (!rl.allowed) return rl.response!;

  return NextResponse.json({
    serverTime: new Date().toISOString(),
    timezone: "UTC",
  });
}
