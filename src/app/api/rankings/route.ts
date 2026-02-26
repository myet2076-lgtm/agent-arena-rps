import { rankingFacade } from "@/lib/ranking";
import { getCurrentSeasonId } from "@/lib/ranking/season";
import type { LeaderboardPeriod } from "@/lib/ranking/leaderboard";
import { NextRequest, NextResponse } from "next/server";

function normalizePeriod(period: "weekly" | "season"): LeaderboardPeriod {
  return period === "season" ? "seasonal" : "weekly";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const type = request.nextUrl.searchParams.get("type") ?? "agents";
  const period = (request.nextUrl.searchParams.get("period") ?? "weekly") as "weekly" | "season";

  if (type !== "agents" && type !== "viewers") {
    return NextResponse.json({ error: "type must be agents or viewers" }, { status: 400 });
  }

  if (period !== "weekly" && period !== "season") {
    return NextResponse.json({ error: "period must be weekly or season" }, { status: 400 });
  }

  const rankings = await rankingFacade.getRankings(type, getCurrentSeasonId(), normalizePeriod(period));

  return NextResponse.json({ type, period, rankings }, { status: 200 });
}
