import type { EloRating, ViewerRanking } from "@/types";

/** Period selector for leaderboard aggregation windows. */
export type LeaderboardPeriod = "weekly" | "seasonal" | "all";

/**
 * Computed agent ranking row.
 */
export interface AgentLeaderboardEntry {
  agentId: string;
  rating: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  rank: number;
}

/**
 * Computed viewer ranking row.
 */
export interface ViewerLeaderboardEntry extends ViewerRanking {
  rank: number;
}

/**
 * Badge rule definition.
 */
export interface BadgeRule {
  id: string;
  minStreak: number;
}

/** Default streak-based badge progression rules. */
export const DEFAULT_BADGE_RULES: BadgeRule[] = [
  { id: "读牌者", minStreak: 3 },
  { id: "预言家", minStreak: 10 },
  { id: "先知", minStreak: 20 },
];

/**
 * Persistence abstraction for ranking data.
 */
export interface RankingRepository {
  listEloRatingsBySeason(seasonId: string, period?: LeaderboardPeriod): Promise<EloRating[]>;
  listViewerRankingsBySeason(
    seasonId: string,
    period?: LeaderboardPeriod,
  ): Promise<ViewerRanking[]>;
  getViewerRanking(viewerId: string, seasonId: string): Promise<ViewerRanking | null>;
  upsertViewerRanking(ranking: ViewerRanking): Promise<ViewerRanking>;
}

/**
 * In-memory ranking repository for tests/local runtime.
 */
export class InMemoryRankingRepository implements RankingRepository {
  public readonly eloRatings: EloRating[] = [];

  public readonly viewerRankings = new Map<string, ViewerRanking>();

  async listEloRatingsBySeason(_seasonId: string): Promise<EloRating[]> {
    return this.eloRatings;
  }

  async listViewerRankingsBySeason(_seasonId: string): Promise<ViewerRanking[]> {
    return [...this.viewerRankings.values()];
  }

  async getViewerRanking(viewerId: string, seasonId: string): Promise<ViewerRanking | null> {
    return this.viewerRankings.get(`${seasonId}:${viewerId}`) ?? null;
  }

  async upsertViewerRanking(ranking: ViewerRanking): Promise<ViewerRanking> {
    this.viewerRankings.set(`${ranking.seasonId}:${ranking.viewerId}`, ranking);
    return ranking;
  }
}

/**
 * Ranking service for agent/viewer leaderboards and badge progression.
 */
export class LeaderboardService {
  constructor(
    private readonly repository: RankingRepository,
    private readonly seasonIdResolver: () => string,
    private readonly badgeRules: BadgeRule[] = DEFAULT_BADGE_RULES,
  ) {}

  /**
   * Returns sorted agent leaderboard for a season.
   */
  async getAgentLeaderboard(
    seasonId: string,
    period: LeaderboardPeriod = "seasonal",
  ): Promise<AgentLeaderboardEntry[]> {
    const ratings = await this.repository.listEloRatingsBySeason(seasonId, period);

    const latestByAgent = new Map<string, EloRating>();
    for (const rating of ratings) {
      const current = latestByAgent.get(rating.agentId);
      if (!current || current.updatedAt < rating.updatedAt) {
        latestByAgent.set(rating.agentId, rating);
      }
    }

    const matchesByAgent = new Map<string, number>();
    const winsByAgent = new Map<string, number>();
    const lossesByAgent = new Map<string, number>();
    const drawsByAgent = new Map<string, number>();
    for (const rating of ratings) {
      matchesByAgent.set(rating.agentId, (matchesByAgent.get(rating.agentId) ?? 0) + 1);
      if (rating.delta > 0) {
        winsByAgent.set(rating.agentId, (winsByAgent.get(rating.agentId) ?? 0) + 1);
      } else if (rating.delta < 0) {
        lossesByAgent.set(rating.agentId, (lossesByAgent.get(rating.agentId) ?? 0) + 1);
      } else {
        drawsByAgent.set(rating.agentId, (drawsByAgent.get(rating.agentId) ?? 0) + 1);
      }
    }

    return [...latestByAgent.values()]
      .sort((a, b) => b.rating - a.rating)
      .map((rating, index) => ({
        agentId: rating.agentId,
        rating: rating.rating,
        matches: matchesByAgent.get(rating.agentId) ?? 0,
        wins: winsByAgent.get(rating.agentId) ?? 0,
        losses: lossesByAgent.get(rating.agentId) ?? 0,
        draws: drawsByAgent.get(rating.agentId) ?? 0,
        rank: index + 1,
      }));
  }

  /**
   * Returns sorted viewer leaderboard by hitRate (then correctVotes).
   */
  async getViewerLeaderboard(
    seasonId: string,
    period: LeaderboardPeriod = "seasonal",
  ): Promise<ViewerLeaderboardEntry[]> {
    const rankings = await this.repository.listViewerRankingsBySeason(seasonId, period);

    return rankings
      .slice()
      .sort((a, b) => {
        if (b.hitRate !== a.hitRate) {
          return b.hitRate - a.hitRate;
        }
        if (b.correctVotes !== a.correctVotes) {
          return b.correctVotes - a.correctVotes;
        }
        return b.bestStreak - a.bestStreak;
      })
      .map((ranking, index) => ({ ...ranking, rank: index + 1 }));
  }

  /**
   * Updates viewer prediction stats for one match outcome and returns latest ranking.
   */
  async updateViewerStats(
    viewerId: string,
    matchId: string,
    wasCorrect: boolean,
  ): Promise<ViewerRanking> {
    const seasonId = this.seasonIdResolver();
    const existing = await this.repository.getViewerRanking(viewerId, seasonId);

    const totalVotes = (existing?.totalVotes ?? 0) + 1;
    const correctVotes = (existing?.correctVotes ?? 0) + (wasCorrect ? 1 : 0);
    const currentStreak = wasCorrect ? (existing?.currentStreak ?? 0) + 1 : 0;
    const bestStreak = Math.max(existing?.bestStreak ?? 0, currentStreak);

    const updated: ViewerRanking = {
      id: existing?.id ?? `vr_${seasonId}_${viewerId}`,
      viewerId,
      seasonId,
      totalVotes,
      correctVotes,
      hitRate: totalVotes === 0 ? 0 : correctVotes / totalVotes,
      currentStreak,
      bestStreak,
      badges: existing?.badges ?? [],
      votedMatchIds: [...new Set([...(existing?.votedMatchIds ?? []), matchId])],
      updatedAt: new Date(),
    };

    const newlyAwarded = this.getAwardableBadges(updated);
    if (newlyAwarded.length > 0) {
      updated.badges = [...new Set([...updated.badges, ...newlyAwarded])];
    }

    await this.repository.upsertViewerRanking(updated);

    return updated;
  }

  /**
   * Checks and awards newly unlocked badges for a viewer.
   */
  async checkAndAwardBadges(viewerId: string): Promise<string[]> {
    const seasonId = this.seasonIdResolver();
    const ranking = await this.repository.getViewerRanking(viewerId, seasonId);
    if (!ranking) {
      return [];
    }

    const newlyAwarded = this.getAwardableBadges(ranking);
    if (newlyAwarded.length === 0) {
      return [];
    }

    ranking.badges = [...new Set([...ranking.badges, ...newlyAwarded])];
    ranking.updatedAt = new Date();
    await this.repository.upsertViewerRanking(ranking);

    return newlyAwarded;
  }

  private getAwardableBadges(ranking: ViewerRanking): string[] {
    const owned = new Set(ranking.badges);

    return this.badgeRules
      .filter((rule) => ranking.currentStreak >= rule.minStreak && !owned.has(rule.id))
      .map((rule) => rule.id);
  }
}
