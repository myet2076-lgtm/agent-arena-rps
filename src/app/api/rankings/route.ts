import { rankingFacade } from "@/lib/ranking";
import { getCurrentSeasonId } from "@/lib/ranking/season";
import type { LeaderboardPeriod } from "@/lib/ranking/leaderboard";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { ApiError, handleApiError } from "@/lib/server/api-error";

function normalizePeriod(period: "weekly" | "season"): LeaderboardPeriod {
  return period === "season" ? "seasonal" : "weekly";
}

export const GET = handleApiError(async (req: Request) => {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(null, ip);
  if (!rl.allowed) return rl.response!;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "agents";
  const period = (url.searchParams.get("period") ?? "weekly") as "weekly" | "season";

  if (type !== "agents" && type !== "viewers") {
    throw new ApiError(400, "BAD_REQUEST", "type must be agents or viewers");
  }

  if (period !== "weekly" && period !== "season") {
    throw new ApiError(400, "BAD_REQUEST", "period must be weekly or season");
  }

  const rankings = await rankingFacade.getRankings(type, getCurrentSeasonId(), normalizePeriod(period));

  return NextResponse.json({ type, period, rankings }, { status: 200 });
});
