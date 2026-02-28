import { describe, expect, it } from "vitest";
import { normalizeEvent } from "../useMatchSSE";
import { RoundOutcome, SSE_EVENT_TYPES } from "@/types";

describe("normalizeEvent", () => {
  describe("ROUND_RESULT", () => {
    it("maps round→roundNo and derives outcome from winner=null as DRAW", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.ROUND_RESULT,
        matchId: "m1",
        round: 3,
        winner: null,
        scoreA: 1,
        scoreB: 1,
        moveA: "ROCK",
        moveB: "ROCK",
        predictionBonusA: false,
        predictionBonusB: false,
      });

      expect(result.type).toBe("ROUND_RESULT");
      if (result.type !== "ROUND_RESULT") throw new Error("wrong type");
      expect(result.roundNo).toBe(3);
      expect(result.outcome).toBe(RoundOutcome.DRAW);
      expect(result.pointsA).toBe(0);
      expect(result.pointsB).toBe(0);
    });

    it("preserves roundNo if already present (prefers roundNo over round)", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.ROUND_RESULT,
        matchId: "m1",
        roundNo: 5,
        round: 3,
        winner: null,
        scoreA: 0,
        scoreB: 0,
      });

      if (result.type !== "ROUND_RESULT") throw new Error("wrong type");
      expect(result.roundNo).toBe(5);
    });

    it("derives WIN_A from winner='A'", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.ROUND_RESULT,
        matchId: "m1",
        round: 1,
        winner: "A",
        scoreA: 1,
        scoreB: 0,
      });

      if (result.type !== "ROUND_RESULT") throw new Error("wrong type");
      expect(result.outcome).toBe(RoundOutcome.WIN_A);
      expect(result.pointsA).toBe(1);
      expect(result.pointsB).toBe(0);
    });

    it("derives WIN_B from winner='B'", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.ROUND_RESULT,
        matchId: "m1",
        round: 1,
        winner: "B",
        scoreA: 0,
        scoreB: 1,
      });

      if (result.type !== "ROUND_RESULT") throw new Error("wrong type");
      expect(result.outcome).toBe(RoundOutcome.WIN_B);
    });

    it("derives WIN_A from winner='agentA'", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.ROUND_RESULT,
        matchId: "m1",
        round: 1,
        winner: "agentA",
        scoreA: 1,
        scoreB: 0,
      });

      if (result.type !== "ROUND_RESULT") throw new Error("wrong type");
      expect(result.outcome).toBe(RoundOutcome.WIN_A);
    });

    it("derives WIN_B from winner='agentB'", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.ROUND_RESULT,
        matchId: "m1",
        round: 1,
        winner: "agentB",
        scoreA: 0,
        scoreB: 1,
      });

      if (result.type !== "ROUND_RESULT") throw new Error("wrong type");
      expect(result.outcome).toBe(RoundOutcome.WIN_B);
    });

    it("treats winner='draw' as DRAW", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.ROUND_RESULT,
        matchId: "m1",
        round: 1,
        winner: "draw",
        scoreA: 0,
        scoreB: 0,
      });

      if (result.type !== "ROUND_RESULT") throw new Error("wrong type");
      expect(result.outcome).toBe(RoundOutcome.DRAW);
    });

    it("awards 2 points for prediction bonus win", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.ROUND_RESULT,
        matchId: "m1",
        round: 1,
        winner: "A",
        predictionBonusA: true,
        predictionBonusB: false,
        scoreA: 2,
        scoreB: 0,
      });

      if (result.type !== "ROUND_RESULT") throw new Error("wrong type");
      expect(result.pointsA).toBe(2);
      expect(result.pointsB).toBe(0);
    });

    it("uses explicit outcome if provided (ignores winner)", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.ROUND_RESULT,
        matchId: "m1",
        round: 1,
        outcome: RoundOutcome.WIN_B,
        winner: "A",
        scoreA: 0,
        scoreB: 1,
      });

      if (result.type !== "ROUND_RESULT") throw new Error("wrong type");
      expect(result.outcome).toBe(RoundOutcome.WIN_B);
    });

    it("uses explicit pointsA/B if provided", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.ROUND_RESULT,
        matchId: "m1",
        round: 1,
        winner: "A",
        pointsA: 10,
        pointsB: 5,
        scoreA: 10,
        scoreB: 5,
      });

      if (result.type !== "ROUND_RESULT") throw new Error("wrong type");
      expect(result.pointsA).toBe(10);
      expect(result.pointsB).toBe(5);
    });
  });

  describe("MATCH_FINISHED", () => {
    it("maps winnerId from winnerId field", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.MATCH_FINISHED,
        matchId: "m1",
        winnerId: "agent-123",
        finalScoreA: 4,
        finalScoreB: 2,
      });

      if (result.type !== "MATCH_FINISHED") throw new Error("wrong type");
      expect(result.winnerId).toBe("agent-123");
      expect(result.finalScoreA).toBe(4);
      expect(result.finalScoreB).toBe(2);
    });

    it("falls back winner field to winnerId", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.MATCH_FINISHED,
        matchId: "m1",
        winner: "agent-456",
        scoreA: 4,
        scoreB: 1,
      });

      if (result.type !== "MATCH_FINISHED") throw new Error("wrong type");
      expect(result.winnerId).toBe("agent-456");
      expect(result.finalScoreA).toBe(4);
      expect(result.finalScoreB).toBe(1);
    });

    it("handles null winner (draw)", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.MATCH_FINISHED,
        matchId: "m1",
        winnerId: null,
        finalScoreA: 3,
        finalScoreB: 3,
      });

      if (result.type !== "MATCH_FINISHED") throw new Error("wrong type");
      expect(result.winnerId).toBeNull();
    });

    it("maps eloChange fields", () => {
      const result = normalizeEvent({
        type: SSE_EVENT_TYPES.MATCH_FINISHED,
        matchId: "m1",
        winnerId: "a1",
        finalScoreA: 4,
        finalScoreB: 2,
        eloChangeA: 15,
        eloChangeB: -15,
      });

      if (result.type !== "MATCH_FINISHED") throw new Error("wrong type");
      expect(result.eloChangeA).toBe(15);
      expect(result.eloChangeB).toBe(-15);
    });
  });

  describe("passthrough events", () => {
    it("passes unknown event types through as-is", () => {
      const raw = { type: "MARKET_UPDATE", matchId: "m1", impliedProbA: 0.6, impliedProbB: 0.4, volume: 100 };
      const result = normalizeEvent(raw);
      expect(result).toEqual(raw);
    });
  });
});
