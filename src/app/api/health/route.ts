import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { handleApiError } from "@/lib/server/api-error";

export const GET = handleApiError(async (req: Request): Promise<NextResponse> => {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(null, ip);
  if (!rl.allowed) return rl.response!;

  return NextResponse.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
