import { describe, expect, it } from "vitest";
import { MatchStatus } from "../src/types";
import type { EloRating, MarketMapping, Match } from "../src/types";
import {
  PolymarketClient,
  VoteService,
  InMemoryVoteRepository,
  InMemoryMarketRepository,
  MarketService,
} from "../src/lib/market";
import {
  calculateEloChange,
  deriveScoreFromMatch,
  InMemoryRankingRepository,
  LeaderboardService,
} from "../src/lib/ranking";

function buildMatch(scoreA: number, scoreB: number): Match {
  const now = new Date("2026-02-26T00:00:00.000Z");

  return {
    id: `m-${scoreA}-${scoreB}`,
    seasonId: "season-1",
    agentA: "agent-a",
    agentB: "agent-b",
    status: MatchStatus.FINISHED,
    format: "BO7",
    scoreA,
    scoreB,
    winsA: 0,
    winsB: 0,
    currentRound: 0,
    maxRounds: 12,
    winnerId: scoreA === scoreB ? null : scoreA > scoreB ? "agent-a" : "agent-b",
    startedAt: now,
    finishedAt: now,
    createdAt: now,
  };
}

describe("vote-service", () => {
  it("prevents duplicate vote per viewer/match/round", async () => {
    const repository = new InMemoryVoteRepository();
    const service = new VoteService(repository);

    await service.castVote("match-1", "viewer-1", "A", 1);

    await expect(service.castVote("match-1", "viewer-1", "B", 1)).rejects.toThrow(
      "already voted",
    );
  });
});

describe("elo", () => {
  it("matches known Elo vector: equal ratings winner gets +16 (K=32)", () => {
    const { deltaA, deltaB } = calculateEloChange(1200, 1200, "A", 32);
    expect(deltaA).toBe(16);
    expect(deltaB).toBe(-16);
  });

  it("supports points-based fractional outcome", () => {
    const { deltaA, deltaB } = calculateEloChange(1400, 1200, 0.6, 32);
    expect(deltaA).toBeLessThan(0); // 1400 expected score is ~0.76, actual only 0.6
    expect(deltaB).toBeGreaterThan(0);
  });

  it("4-0 sweep maps to score 1.0 and full Elo gain", () => {
    const scoreA = deriveScoreFromMatch(buildMatch(4, 0));
    const { deltaA, deltaB } = calculateEloChange(1200, 1200, scoreA, 32);

    expect(scoreA).toBe(1);
    expect(deltaA).toBe(16);
    expect(deltaB).toBe(-16);
  });

  it("4-3 narrow win maps to ~0.57 and modest Elo gain", () => {
    const scoreA = deriveScoreFromMatch(buildMatch(4, 3));
    const { deltaA, deltaB } = calculateEloChange(1200, 1200, scoreA, 32);

    expect(scoreA).toBeCloseTo(4 / 7, 6);
    expect(deltaA).toBe(2);
    expect(deltaB).toBe(-2);
  });

  it("0-4 loss maps to score 0.0 and full Elo loss", () => {
    const scoreA = deriveScoreFromMatch(buildMatch(0, 4));
    const { deltaA, deltaB } = calculateEloChange(1200, 1200, scoreA, 32);

    expect(scoreA).toBe(0);
    expect(deltaA).toBe(-16);
    expect(deltaB).toBe(16);
  });

  it("0-0 maps to 0.5 draw to avoid division by zero", () => {
    const scoreA = deriveScoreFromMatch(buildMatch(0, 0));
    const { deltaA, deltaB } = calculateEloChange(1200, 1200, scoreA, 32);

    expect(scoreA).toBe(0.5);
    expect(deltaA).toBe(0);
    expect(deltaB).toBe(0);
  });
});

describe("leaderboard", () => {
  it("sorts agent leaderboard by latest rating desc", async () => {
    const repository = new InMemoryRankingRepository();
    const seasonId = "season-1";

    const now = new Date("2026-02-26T00:00:00.000Z");
    const ratings: EloRating[] = [
      {
        id: "1",
        agentId: "agent-a",
        rating: 1210,
        matchId: "m1",
        delta: 10,
        updatedAt: new Date(now.getTime() + 1),
      },
      {
        id: "2",
        agentId: "agent-b",
        rating: 1280,
        matchId: "m1",
        delta: 80,
        updatedAt: new Date(now.getTime() + 2),
      },
      {
        id: "3",
        agentId: "agent-a",
        rating: 1300,
        matchId: "m2",
        delta: 90,
        updatedAt: new Date(now.getTime() + 3),
      },
    ];
    repository.eloRatings.push(...ratings);

    const service = new LeaderboardService(repository, () => seasonId);
    const board = await service.getAgentLeaderboard(seasonId);

    expect(board[0].agentId).toBe("agent-a");
    expect(board[0].rating).toBe(1300);
    expect(board[1].agentId).toBe("agent-b");
  });

  it("awards badges based on streak progression", async () => {
    const repository = new InMemoryRankingRepository();
    const seasonId = "season-1";
    const service = new LeaderboardService(repository, () => seasonId);

    for (let i = 0; i < 3; i += 1) {
      await service.updateViewerStats("viewer-1", `m-${i}`, true);
    }

    const awardedAfter3 = await service.checkAndAwardBadges("viewer-1");
    expect(awardedAfter3).toEqual([]); // already auto-awarded in updateViewerStats

    const ranking = await repository.getViewerRanking("viewer-1", seasonId);
    expect(ranking?.badges).toContain("读牌者");
    expect(ranking?.votedMatchIds).toEqual(["m-0", "m-1", "m-2"]);
  });
});

describe("market degradation", () => {
  it("returns null when no market mapping exists", async () => {
    const mappingRepo = new InMemoryMarketRepository();
    const client = new PolymarketClient(async () => {
      throw new Error("should not call");
    });
    const service = new MarketService(mappingRepo, client);

    const snapshot = await service.syncMarketData("unknown-match");
    expect(snapshot).toBeNull();
  });

  it("falls back to degraded snapshot when API is unavailable", async () => {
    const mapping: MarketMapping = {
      id: "mm-1",
      matchId: "match-1",
      polymarketMarketId: "poly-1",
      polymarketUrl: "https://polymarket.com/event/test",
      status: "ACTIVE",
      createdAt: new Date(),
    };

    const mappingRepo = new InMemoryMarketRepository([mapping]);
    const client = new PolymarketClient(async () => {
      throw new Error("network down");
    });
    const service = new MarketService(mappingRepo, client);

    const snapshot = await service.syncMarketData("match-1");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.impliedProbA).toBe(0.5);
    expect(snapshot?.impliedProbB).toBe(0.5);
    expect(snapshot?.volume).toBe(0);
  });
});
