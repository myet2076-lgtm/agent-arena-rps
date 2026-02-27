import type { AgentRecord, AgentStatus, MarketSnapshot, Match, QualificationMatch, QueueEntry, Round } from "./domain";

/** JSON-serialized versions of domain types for API transport */
export type Serialized<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K] extends Array<infer U>
        ? Serialized<U>[]
        : T[K] extends object
          ? Serialized<T[K]>
          : T[K];
};

export type MatchDTO = Serialized<Match>;
export type RoundDTO = Serialized<Round>;
export type MarketSnapshotDTO = Serialized<MarketSnapshot>;

// ─── Agent Registration ─────────────────────────────────

export interface AgentRegistrationRequest {
  name: string;
  description?: string;
  avatarUrl?: string;
}

export interface AgentRegistrationResponse {
  agentId: string;
  name: string;
  apiKey: string;
  status: AgentStatus;
  elo: number;
}

// ─── Public Agent DTO (no sensitive fields) ─────────────

export type AgentDTO = Serialized<Omit<AgentRecord, "keyHash" | "settings">>;

export type QueueEntryDTO = Serialized<QueueEntry>;
export type QualificationMatchDTO = Serialized<QualificationMatch>;

// ─── Rules & Time ───────────────────────────────────────

export interface RulesResponse {
  format: string;
  winScore: number;
  maxRounds: number;
  scoring: {
    normalWin: number;
    predictionBonus: number;
    draw: number;
    timeout: number;
  };
  timeouts: {
    commitSec: number;
    revealSec: number;
    roundIntervalSec: number;
    readyCheckSec: number;
  };
  moves: string[];
  hashFormat: string;
}

export interface TimeResponse {
  serverTime: string;
  timezone: string;
}

// ─── Match ──────────────────────────────────────────────

export interface MatchResponseDTO {
  match: MatchDTO;
  rounds: RoundDTO[];
  market: MarketSnapshotDTO | null;
  votes: { a: number; b: number };
}
