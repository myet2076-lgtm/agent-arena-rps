/**
 * House Bot — Qualification opponent (PRD §3.3)
 * Difficulty levels: easy, medium, hard
 * Seedable PRNG for test reproducibility
 */

import { Move, type QualDifficulty } from "@/types";

const MOVES = [Move.ROCK, Move.PAPER, Move.SCISSORS] as const;

/** Simple seedable PRNG (mulberry32) */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Beats the given move */
function counter(move: Move): Move {
  if (move === Move.ROCK) return Move.PAPER;
  if (move === Move.PAPER) return Move.SCISSORS;
  return Move.ROCK;
}

export class HouseBot {
  private rng: () => number;
  private history: Move[] = [];
  private difficulty: QualDifficulty;

  constructor(difficulty: QualDifficulty, seed?: number) {
    this.difficulty = difficulty;
    this.rng = mulberry32(seed ?? Date.now());
  }

  /** Get next move given opponent's previous moves */
  nextMove(opponentHistory: Move[] = []): Move {
    this.history = opponentHistory;
    switch (this.difficulty) {
      case "easy":
        return this.easyMove();
      case "medium":
        return this.mediumMove();
      case "hard":
        return this.hardMove();
    }
  }

  /** Easy: 65-75% one move (ROCK), rest random — easily exploitable */
  private easyMove(): Move {
    const r = this.rng();
    // ~70% ROCK, ~15% PAPER, ~15% SCISSORS
    if (r < 0.70) return Move.ROCK;
    if (r < 0.85) return Move.PAPER;
    return Move.SCISSORS;
  }

  /** Medium: tracks opponent patterns and plays accordingly ~50% of time */
  private mediumMove(): Move {
    const r = this.rng();
    if (this.history.length < 2 || r < 0.4) {
      return MOVES[Math.floor(this.rng() * 3)];
    }
    // Find most common opponent move and counter it
    const counts = { ROCK: 0, PAPER: 0, SCISSORS: 0 };
    for (const m of this.history) counts[m]++;
    const mostCommon = MOVES.reduce((a, b) => (counts[a] >= counts[b] ? a : b));
    return counter(mostCommon);
  }

  /** Hard: counter-strategy — counters opponent's last move ~70% of time */
  private hardMove(): Move {
    const r = this.rng();
    if (this.history.length === 0 || r < 0.3) {
      return MOVES[Math.floor(this.rng() * 3)];
    }
    return counter(this.history[this.history.length - 1]);
  }
}
