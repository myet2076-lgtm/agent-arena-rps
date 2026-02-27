import { describe, it, expect } from "vitest";
import { HouseBot } from "../house-bot";
import { Move } from "@/types";

describe("HouseBot", () => {
  describe("easy mode", () => {
    it("produces 65-75% of one dominant move over 1000 rounds", () => {
      const bot = new HouseBot("easy", 42);
      const counts = { ROCK: 0, PAPER: 0, SCISSORS: 0 };
      for (let i = 0; i < 1000; i++) {
        const move = bot.nextMove([]);
        counts[move]++;
      }
      // ROCK should be dominant at 65-75%
      const rockPct = counts.ROCK / 1000;
      expect(rockPct).toBeGreaterThanOrEqual(0.63); // small tolerance
      expect(rockPct).toBeLessThanOrEqual(0.77);
    });

    it("is seedable and reproducible", () => {
      const bot1 = new HouseBot("easy", 123);
      const bot2 = new HouseBot("easy", 123);
      const moves1 = Array.from({ length: 20 }, () => bot1.nextMove([]));
      const moves2 = Array.from({ length: 20 }, () => bot2.nextMove([]));
      expect(moves1).toEqual(moves2);
    });
  });

  describe("medium mode", () => {
    it("returns valid moves", () => {
      const bot = new HouseBot("medium", 99);
      for (let i = 0; i < 50; i++) {
        const move = bot.nextMove([Move.ROCK, Move.ROCK, Move.ROCK]);
        expect([Move.ROCK, Move.PAPER, Move.SCISSORS]).toContain(move);
      }
    });
  });

  describe("hard mode", () => {
    it("counters last move frequently", () => {
      const bot = new HouseBot("hard", 55);
      let counters = 0;
      const total = 200;
      for (let i = 0; i < total; i++) {
        const move = bot.nextMove([Move.ROCK]);
        if (move === Move.PAPER) counters++;
      }
      // Should counter ~70% of time
      expect(counters / total).toBeGreaterThan(0.5);
    });
  });
});
