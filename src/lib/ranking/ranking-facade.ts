import type { Match, Vote } from "@/types";
import {
  type EloDataProvider,
  type EloConfig,
  DEFAULT_ELO_CONFIG,
  updateEloRatings,
} from "./elo";
import {
  type AgentLeaderboardEntry,
  type LeaderboardPeriod,
  type RankingRepository,
  type ViewerLeaderboardEntry,
  LeaderboardService,
} from "./leaderboard";

/**
 * Combined dependencies required by the ranking facade.
 */
export interface RankingFacadeDependencies {
  rankingRepository: RankingRepository;
  eloProvider: EloDataProvider;
  seasonIdResolver: () => string;
  eloConfig?: EloConfig;
}

/**
 * Finished match payload used for end-of-match ranking processing.
 */
export interface MatchResultInput {
  match: Match;
  votes: Vote[];
}

/**
 * Unified entry point for ranking read/write workflows.
 *
 * - `getRankings()` powers API reads for agent/viewer boards
 * - `processMatchResult()` applies ELO updates and viewer prediction updates
 */
export class RankingFacade {
  private readonly leaderboardService: LeaderboardService;

  private readonly eloProvider: EloDataProvider;

  private readonly eloConfig: EloConfig;

  constructor(private readonly deps: RankingFacadeDependencies) {
    this.leaderboardService = new LeaderboardService(
      deps.rankingRepository,
      deps.seasonIdResolver,
    );
    this.eloProvider = deps.eloProvider;
    this.eloConfig = deps.eloConfig ?? DEFAULT_ELO_CONFIG;
  }

  /**
   * Returns rankings for agents or viewers using leaderboard service logic.
   */
  async getRankings(
    type: "agents" | "viewers",
    seasonId: string,
    period: LeaderboardPeriod = "seasonal",
  ): Promise<AgentLeaderboardEntry[] | ViewerLeaderboardEntry[]> {
    if (type === "agents") {
      return this.leaderboardService.getAgentLeaderboard(seasonId, period);
    }

    return this.leaderboardService.getViewerLeaderboard(seasonId, period);
  }

  /**
   * Processes a finished match:
   * 1) computes ELO updates for both agents
   * 2) updates viewer hit-rate/streak stats for all voters
   */
  async processMatchResult(input: MatchResultInput): Promise<{
    ratings: Awaited<ReturnType<typeof updateEloRatings>>;
  }> {
    const { match, votes } = input;

    const ratings = await updateEloRatings(match, this.eloProvider, this.eloConfig);

    const winnerSide = match.winnerId === match.agentA
      ? "A"
      : match.winnerId === match.agentB
        ? "B"
        : null;

    const latestByViewer = new Map<string, Vote>();
    for (const vote of votes) {
      const current = latestByViewer.get(vote.viewerId);
      if (!current || current.createdAt < vote.createdAt) {
        latestByViewer.set(vote.viewerId, vote);
      }
    }

    await Promise.all(
      [...latestByViewer.values()].map((vote) => this.leaderboardService.updateViewerStats(
        vote.viewerId,
        match.id,
        winnerSide === null ? false : vote.side === winnerSide,
      )),
    );

    return { ratings };
  }
}
