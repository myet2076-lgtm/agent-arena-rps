import type { EloRating, Match } from "@/types";

/**
 * ELO outcome input.
 * - "A" => A wins
 * - "B" => B wins
 * - "DRAW" => draw
 * - number => direct score for A in [0,1] (B = 1 - A)
 */
export type EloOutcome = "A" | "B" | "DRAW" | number;

/**
 * ELO model parameters.
 */
export interface EloConfig {
  newAgentKFactor: number;
  establishedAgentKFactor: number;
  newAgentThresholdMatches: number;
  defaultRating: number;
}

/** Default ELO configuration values used by ranking services. */
export const DEFAULT_ELO_CONFIG: EloConfig = {
  newAgentKFactor: 32,
  establishedAgentKFactor: 16,
  newAgentThresholdMatches: 30,
  defaultRating: 1200,
};

/**
 * Computes the ELO delta for both sides.
 */
export function calculateEloChange(
  ratingA: number,
  ratingB: number,
  outcome: EloOutcome,
  kFactor = 32,
): { deltaA: number; deltaB: number } {
  const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  const scoreA = normalizeOutcomeToScoreA(outcome);
  const scoreB = 1 - scoreA;

  const deltaA = Math.round(kFactor * (scoreA - expectedA));
  const deltaB = Math.round(kFactor * (scoreB - expectedB));

  return { deltaA, deltaB };
}

/**
 * Dependency interface for loading current ratings and match counts.
 */
export interface EloDataProvider {
  getCurrentRating(agentId: string): Promise<number | null>;
  getMatchCount(agentId: string): Promise<number>;
}

/**
 * Updates ELO ratings based on a finished match.
 * Uses dynamic K-factor:
 * - 32 for new agents (< 30 matches)
 * - 16 for established agents
 */
export async function updateEloRatings(
  match: Match,
  provider: EloDataProvider,
  config: EloConfig = DEFAULT_ELO_CONFIG,
): Promise<{ ratingA: EloRating; ratingB: EloRating }> {
  const [currentA, currentB, matchCountA, matchCountB] = await Promise.all([
    provider.getCurrentRating(match.agentA),
    provider.getCurrentRating(match.agentB),
    provider.getMatchCount(match.agentA),
    provider.getMatchCount(match.agentB),
  ]);

  const ratingAStart = currentA ?? config.defaultRating;
  const ratingBStart = currentB ?? config.defaultRating;

  const scoreA = deriveScoreFromMatch(match);
  const kA = matchCountA < config.newAgentThresholdMatches
    ? config.newAgentKFactor
    : config.establishedAgentKFactor;
  const kB = matchCountB < config.newAgentThresholdMatches
    ? config.newAgentKFactor
    : config.establishedAgentKFactor;
  const effectiveK = Math.round((kA + kB) / 2);

  const { deltaA, deltaB } = calculateEloChange(ratingAStart, ratingBStart, scoreA, effectiveK);

  const now = new Date();

  return {
    ratingA: {
      id: `elo_${match.id}_${match.agentA}`,
      agentId: match.agentA,
      rating: ratingAStart + deltaA,
      matchId: match.id,
      delta: deltaA,
      updatedAt: now,
    },
    ratingB: {
      id: `elo_${match.id}_${match.agentB}`,
      agentId: match.agentB,
      rating: ratingBStart + deltaB,
      matchId: match.id,
      delta: deltaB,
      updatedAt: now,
    },
  };
}

/**
 * Convert points-based match result to ELO score in [0,1].
 * Uses total points to support prediction-bonus weighting.
 */
export function deriveScoreFromMatch(match: Match): number {
  const total = match.scoreA + match.scoreB;

  if (total <= 0) {
    return 0.5;
  }

  return clamp01(match.scoreA / total);
}

function normalizeOutcomeToScoreA(outcome: EloOutcome): number {
  if (typeof outcome === "number") {
    return clamp01(outcome);
  }

  if (outcome === "A") {
    return 1;
  }
  if (outcome === "B") {
    return 0;
  }
  return 0.5;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
