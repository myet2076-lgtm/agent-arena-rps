import type { EloDataProvider } from "./elo";
import type { RankingRepository } from "./leaderboard";
import { RankingFacade } from "./ranking-facade";
import { getCurrentSeasonId } from "./season";
import { db } from "@/lib/server/in-memory-db";

const eloProvider: EloDataProvider = {
  async getCurrentRating(agentId: string): Promise<number | null> {
    return db.getCurrentEloRating(agentId)?.rating ?? null;
  },
  async getMatchCount(agentId: string): Promise<number> {
    return db.getEloMatchCount(agentId);
  },
};

const rankingRepository: RankingRepository = {
  async listEloRatingsBySeason(seasonId: string, period) {
    return db.listEloRatingsBySeason(seasonId, period);
  },
  async listViewerRankingsBySeason(seasonId: string, period) {
    return db.getViewerRankings(period === "weekly" ? "weekly" : "season", seasonId);
  },
  async getViewerRanking(viewerId: string, seasonId: string) {
    return db.getViewerRanking(viewerId, seasonId);
  },
  async upsertViewerRanking(ranking) {
    return db.upsertViewerRanking(ranking);
  },
};

export const rankingFacade = new RankingFacade({
  rankingRepository,
  eloProvider,
  seasonIdResolver: getCurrentSeasonId,
});
