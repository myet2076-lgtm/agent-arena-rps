import type { Season } from "@/types";
import type { AgentLeaderboardEntry, LeaderboardService, ViewerLeaderboardEntry } from "./leaderboard";

/**
 * Settlement result payload for season closure.
 */
export interface SeasonSettlement {
  season: Season;
  settledAt: Date;
  agentLeaderboard: AgentLeaderboardEntry[];
  viewerLeaderboard: ViewerLeaderboardEntry[];
}

/**
 * Repository for season lifecycle.
 */
export interface SeasonRepository {
  getCurrentSeason(now: Date): Promise<Season | null>;
  listSeasons(): Promise<Season[]>;
  saveSeason(season: Season): Promise<void>;
  markSeasonSettled(seasonId: string, settledAt: Date): Promise<void>;
}

/**
 * In-memory season repository.
 */
export class InMemorySeasonRepository implements SeasonRepository {
  public readonly seasons: Season[] = [];

  async getCurrentSeason(now: Date): Promise<Season | null> {
    return (
      this.seasons.find(
        (season) => season.startsAt <= now && season.endsAt >= now,
      ) ?? null
    );
  }

  async listSeasons(): Promise<Season[]> {
    return this.seasons.slice();
  }

  async saveSeason(season: Season): Promise<void> {
    const index = this.seasons.findIndex((item) => item.id === season.id);
    if (index >= 0) {
      this.seasons[index] = season;
      return;
    }

    this.seasons.push(season);
  }

  async markSeasonSettled(seasonId: string, settledAt: Date): Promise<void> {
    const season = this.seasons.find((item) => item.id === seasonId);
    if (!season) {
      return;
    }

    season.settledAt = settledAt;
  }
}

/** Optional knobs for season lifecycle behavior. */
export interface SeasonServiceOptions {
  /**
   * Season duration in weeks. Default: 4.
   */
  seasonDurationWeeks?: number;
}

/**
 * Season lifecycle service.
 */
export class SeasonService {
  private readonly seasonDurationWeeks: number;

  constructor(
    private readonly repository: SeasonRepository,
    private readonly leaderboardService: Pick<
      LeaderboardService,
      "getAgentLeaderboard" | "getViewerLeaderboard"
    >,
    options: SeasonServiceOptions = {},
  ) {
    this.seasonDurationWeeks = options.seasonDurationWeeks ?? 4;
  }

  /**
   * Returns current active season; creates one if absent.
   */
  async getCurrentSeason(): Promise<Season> {
    const now = new Date();
    const existing = await this.repository.getCurrentSeason(now);
    if (existing) {
      return existing;
    }

    const startsAt = startOfUtcDay(now);
    const endsAt = addWeeks(startsAt, this.seasonDurationWeeks);
    const created: Season = {
      id: `season_${startsAt.toISOString().slice(0, 10)}`,
      name: `Season ${startsAt.toISOString().slice(0, 10)}`,
      startsAt,
      endsAt,
      settledAt: null,
      createdAt: now,
    };

    await this.repository.saveSeason(created);
    return created;
  }

  /**
   * Settles season rankings and returns leaderboard snapshots.
   */
  async settleSeasonRankings(seasonId: string): Promise<SeasonSettlement> {
    const seasons = await this.repository.listSeasons();
    const season = seasons.find((item) => item.id === seasonId);

    if (!season) {
      throw new Error(`Season not found: ${seasonId}`);
    }

    const [agentLeaderboard, viewerLeaderboard] = await Promise.all([
      this.leaderboardService.getAgentLeaderboard(seasonId, "seasonal"),
      this.leaderboardService.getViewerLeaderboard(seasonId, "seasonal"),
    ]);

    const settledAt = new Date();
    await this.repository.markSeasonSettled(seasonId, settledAt);

    return {
      season: { ...season, settledAt },
      settledAt,
      agentLeaderboard,
      viewerLeaderboard,
    };
  }
}

function startOfUtcDay(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function addWeeks(input: Date, weeks: number): Date {
  return new Date(input.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
}

/** Returns the current active season ID. MVP uses a static value. */
export function getCurrentSeasonId(): string {
  return "season-1";
}
