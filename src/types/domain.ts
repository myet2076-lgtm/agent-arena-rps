/**
 * Agent Arena RPS — Shared Domain Types (Contract Layer)
 * All modules MUST import types from here. No local redefinition.
 * Version: 1.0.0 | 2026-02-26
 */

// ─── Agent Status (PRD §3.1) ────────────────────────────

export enum AgentStatus {
  REGISTERED = "REGISTERED",
  QUALIFYING = "QUALIFYING",
  QUALIFIED = "QUALIFIED",
  QUEUED = "QUEUED",
  MATCHED = "MATCHED",
  IN_MATCH = "IN_MATCH",
  POST_MATCH = "POST_MATCH",
  RESTING = "RESTING",
  BANNED = "BANNED",
}

export interface AgentSettings {
  autoRequeue: boolean;
  maxConsecutiveMatches: number;
  restBetweenSec: number;
  allowedIps: string[];
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  autoRequeue: false,
  maxConsecutiveMatches: 5,
  restBetweenSec: 30,
  allowedIps: [],
};

// ─── Agent (PRD §3.1 — full model) ─────────────────────

export interface AgentRecord {
  id: string;
  name: string;
  keyHash: string;
  status: AgentStatus;
  elo: number;
  description?: string;
  authorEmail?: string;
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  queueCooldownUntil: Date | null;
  queueBanUntil: Date | null;
  consecutiveTimeouts: number;
  suspiciousFlag: boolean;
  settings: AgentSettings;
  consecutiveMatches: number;
  /** Consecutive qualification failures (for escalating cooldown) */
  consecutiveQualFails: number;
  qualifiedAt: Date | null;
  lastQualFailAt: Date | null;
}

// ─── Queue (PRD §3.2) ──────────────────────────────────

export type QueueEntryStatus = "WAITING" | "MATCHED" | "REMOVED";
export type QueueRemovedReason = "MANUAL" | "TIMEOUT" | "MATCHED" | "BANNED";

export interface QueueEntry {
  id: string;
  agentId: string;
  joinedAt: Date;
  lastActivityAt: Date;
  lastSSEPing: Date | null;
  lastPollTimestamp: Date | null;
  status: QueueEntryStatus;
  removedReason?: QueueRemovedReason;
  /** Timestamp when SSE disconnected (for grace period) */
  sseDisconnectedAt: Date | null;
}

// ─── Qualification (PRD §3.3) ───────────────────────────

export interface QualRound {
  round: number;
  agentMove: Move;
  botMove: Move;
  winner: "agent" | "bot" | "draw";
}

export type QualDifficulty = "easy" | "medium" | "hard";
export type QualResult = "PENDING" | "PASS" | "FAIL";

export interface QualificationMatch {
  id: string;
  agentId: string;
  difficulty: QualDifficulty;
  rounds: QualRound[];
  result: QualResult;
  startedAt: Date;
  completedAt: Date | null;
}

// ─── Enums ──────────────────────────────────────────────

export enum Move {
  ROCK = "ROCK",
  PAPER = "PAPER",
  SCISSORS = "SCISSORS",
}

export enum MatchStatus {
  CREATED = "CREATED",
  RUNNING = "RUNNING",
  FINISHED = "FINISHED",
  ARCHIVED = "ARCHIVED",
}

export enum RoundPhase {
  WAIT_COMMIT = "WAIT_COMMIT",
  WAIT_REVEAL = "WAIT_REVEAL",
  JUDGED = "JUDGED",
  PUBLISHED = "PUBLISHED",
}

export enum RoundOutcome {
  WIN_A = "WIN_A",
  WIN_B = "WIN_B",
  DRAW = "DRAW",
  FORFEIT_A = "FORFEIT_A", // A timed out or violated rules
  FORFEIT_B = "FORFEIT_B", // B timed out or violated rules
}

// ─── Core Domain Models ─────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  persona: string; // character/personality description
  avatarUrl: string;
  eloRating: number;
  createdAt: Date;
}

export type MatchPhase =
  | "READY_CHECK"
  | "COMMIT"
  | "REVEAL"
  | "RESULT"
  | "INTERVAL"
  | "FINISHED";

export interface Match {
  id: string;
  seasonId: string;
  agentA: string;  // agent id
  agentB: string;  // agent id
  status: MatchStatus;
  format: "BO7";
  /** Scoring priority: total points first, then round wins as tiebreaker */
  scoreA: number;  // total points (wins count as 1pt, read-bonus wins as 2pt)
  scoreB: number;
  winsA: number;   // round win count
  winsB: number;
  currentRound: number;
  maxRounds: number; // hard cap = 12 (prevents infinite draws)
  winnerId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;

  // Ready check
  readyA: boolean;
  readyB: boolean;
  readyDeadline: Date | null;

  // Phase management
  currentPhase: MatchPhase;
  phaseDeadline: Date | null;

  // ELO tracking
  eloChangeA: number | null;
  eloChangeB: number | null;
  eloUpdatedAt: Date | null;
}

export interface Round {
  id: string;
  matchId: string;
  roundNo: number;  // 1-based
  phase: RoundPhase;
  moveA: Move | null;
  moveB: Move | null;
  outcome: RoundOutcome | null;
  /** Points awarded this round (1 = normal win, 2 = read-bonus win, 0 = draw/loss) */
  pointsA: number;
  pointsB: number;
  predictionBonusA: boolean; // true if A triggered read-bonus
  predictionBonusB: boolean;
  /** Rule violation flags */
  violationA: string | null; // e.g., "CONSECUTIVE_LIMIT"
  violationB: string | null;
  judgedAt: Date | null;
  createdAt: Date;
}

// ─── Commit-Reveal ──────────────────────────────────────

export interface CommitRecord {
  id: string;
  matchId: string;
  roundNo: number;
  agentId: string;
  /** hash = SHA-256(move + salt + roundId + agentId) */
  commitHash: string;
  committedAt: Date;
  expiresAt: Date;  // TTL for timeout enforcement
  /** Optional prediction of opponent's move (read-bonus) */
  prediction: Move | null;
}

export interface RevealRecord {
  id: string;
  matchId: string;
  roundNo: number;
  agentId: string;
  move: Move;
  salt: string;
  verified: boolean;
  revealedAt: Date;
}

// ─── Scoring Rules (Constants) ──────────────────────────

export const RULES = {
  FORMAT: "BO7" as const,
  /** First to this many POINTS wins (not round wins) */
  WIN_THRESHOLD: 4,
  /** Hard round cap to prevent infinite draws */
  MAX_ROUNDS: 12,
  /** Max times a single move can be used per match */
  MOVE_USE_LIMIT: 4,
  /** Max consecutive uses of same move before violation */
  CONSECUTIVE_LIMIT: 3,
  /** Normal win points */
  NORMAL_WIN_POINTS: 1,
  /** Read-bonus win points: beat what opponent played LAST round */
  READ_BONUS_POINTS: 2,
  /** Commit timeout in ms */
  COMMIT_TIMEOUT_MS: 3000,
  /** Reveal timeout in ms */
  REVEAL_TIMEOUT_MS: 3000,
} as const;

// ─── Market / Viewer ────────────────────────────────────

export interface MarketMapping {
  id: string;
  matchId: string;
  polymarketMarketId: string;
  polymarketUrl: string;
  status: "ACTIVE" | "RESOLVED" | "PAUSED";
  createdAt: Date;
}

export interface MarketSnapshot {
  id: string;
  marketMappingId: string;
  impliedProbA: number;  // 0-1
  impliedProbB: number;
  volume: number;
  capturedAt: Date;
}

export interface Vote {
  id: string;
  matchId: string;
  viewerId: string;
  side: "A" | "B";
  roundNo: number | null; // null = pre-match vote
  createdAt: Date;
}

export interface ViewerRanking {
  id: string;
  viewerId: string;
  seasonId: string;
  totalVotes: number;
  correctVotes: number;
  hitRate: number;
  currentStreak: number;
  bestStreak: number;
  badges: string[]; // badge ids
  /** Ordered unique list of matches this viewer has voted on in the season. */
  votedMatchIds: string[];
  updatedAt: Date;
}

export interface Season {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  settledAt: Date | null;
  createdAt: Date;
}

// ─── ELO ────────────────────────────────────────────────

export interface EloRating {
  id: string;
  agentId: string;
  rating: number;
  matchId: string;   // match that caused this update
  delta: number;     // +/- change
  updatedAt: Date;
}

// ─── Share / Highlights ─────────────────────────────────

export interface ShareCard {
  id: string;
  matchId: string;
  imageUrl: string;
  highlightRounds: number[];  // notable round numbers
  shareToken: string;        // unique token for share URL
  createdAt: Date;
}

export interface ShareEvent {
  id: string;
  shareCardId: string;
  viewerId: string | null;
  platform: string; // "twitter" | "telegram" | "copy" etc.
  referralClicks: number;
  createdAt: Date;
}

export type HighlightType = "REVERSAL" | "READ_BONUS" | "MATCH_POINT" | "CLUTCH";

export interface HighlightRound {
  roundNo: number;
  type: HighlightType;
  dramaScore: number;
  reason: string;
}

export interface MatchSummary {
  matchId: string;
  winnerId: string | null;
  finalScoreA: number;
  finalScoreB: number;
  roundsPlayed: number;
  predictionBonusCount: number;
  largestComeback: number;
  momentumSwings: number;
  topHighlights: HighlightRound[];
}

// ─── Events (for Realtime Channel) ─────────────────────

export type GameEvent =
  | { type: "MATCH_STARTED"; matchId: string; agentA: string; agentB: string }
  | { type: "MATCH_START"; matchId: string; round: number; commitDeadline: string }
  | { type: "ROUND_START"; matchId: string; round: number; commitDeadline: string }
  | { type: "BOTH_COMMITTED"; matchId: string; round: number; revealDeadline: string }
  | { type: "ROUND_COMMIT"; matchId: string; roundNo: number; agentId: string }
  | { type: "ROUND_RESULT"; matchId: string; roundNo: number; outcome: RoundOutcome; pointsA: number; pointsB: number; predictionBonusA: boolean; predictionBonusB: boolean; scoreA: number; scoreB: number; moveA?: Move | null; moveB?: Move | null; winner?: string | null }
  | { type: "MATCH_FINISHED"; matchId: string; winnerId: string | null; finalScoreA: number; finalScoreB: number; eloChangeA?: number | null; eloChangeB?: number | null }
  | { type: "MARKET_UPDATE"; matchId: string; impliedProbA: number; impliedProbB: number; volume: number }
  | { type: "VOTE_UPDATE"; matchId: string; votesA: number; votesB: number }
  | { type: "RESYNC"; matchId: string; snapshot: Record<string, unknown> }
  | { type: "READY_TIMEOUT"; matchId: string; readyA: boolean; readyB: boolean };

// ─── API Contracts ──────────────────────────────────────

export interface CommitRequest {
  agentId: string;
  commitHash: string;
}

export interface RevealRequest {
  agentId: string;
  move: Move;
  salt: string;
}

export interface MatchResponse {
  match: Match;
  rounds: Round[];
  market: MarketSnapshot | null;
  votes: { a: number; b: number };
}

// ─── Audit ──────────────────────────────────────────────

export interface AuditLog {
  id: string;
  matchId: string;
  roundNo: number | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}
