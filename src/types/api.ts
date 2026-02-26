import type { MarketSnapshot, Match, Round } from "./domain";

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

export interface MatchResponseDTO {
  match: MatchDTO;
  rounds: RoundDTO[];
  market: MarketSnapshotDTO | null;
  votes: { a: number; b: number };
}
