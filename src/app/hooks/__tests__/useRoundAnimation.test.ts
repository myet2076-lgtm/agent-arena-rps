// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRoundAnimation, type AnimationPhase } from "../useRoundAnimation";
import { Move, RoundOutcome, type GameEvent } from "@/types";

// Mock matchMedia for reduced-motion
function mockReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? reduced : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function makeRoundResult(roundNo: number, overrides?: Partial<GameEvent & { type: "ROUND_RESULT" }>): GameEvent {
  return {
    type: "ROUND_RESULT",
    matchId: "m1",
    roundNo,
    outcome: RoundOutcome.WIN_A,
    pointsA: 1,
    pointsB: 0,
    predictionBonusA: false,
    predictionBonusB: false,
    scoreA: roundNo,
    scoreB: 0,
    moveA: Move.ROCK,
    moveB: Move.SCISSORS,
    winner: "A",
    ...overrides,
  };
}

function makeMatchFinished(): GameEvent {
  return {
    type: "MATCH_FINISHED",
    matchId: "m1",
    winnerId: "agent-a",
    finalScoreA: 4,
    finalScoreB: 2,
  };
}

describe("useRoundAnimation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in idle phase", () => {
    const { result } = renderHook(() => useRoundAnimation(null, "a", "b"));
    expect(result.current.phase).toBe("idle");
  });

  it("transitions through full phase sequence on ROUND_RESULT", () => {
    const event = makeRoundResult(1);
    const { result, rerender } = renderHook(
      ({ evt }) => useRoundAnimation(evt, "a", "b"),
      { initialProps: { evt: null as GameEvent | null } },
    );

    // Trigger event
    rerender({ evt: event });

    const phases: AnimationPhase[] = [];
    phases.push(result.current.phase);
    expect(result.current.phase).toBe("round-announce");

    // round-announce → choosing (800ms)
    act(() => { vi.advanceTimersByTime(800); });
    phases.push(result.current.phase);
    expect(result.current.phase).toBe("choosing");

    // choosing → reveal (1500ms)
    act(() => { vi.advanceTimersByTime(1500); });
    phases.push(result.current.phase);
    expect(result.current.phase).toBe("reveal");

    // reveal → clash (1000ms)
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.phase).toBe("clash");

    // clash → result (1000ms)
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.phase).toBe("result");

    // result → idle (1500ms + 50ms drain)
    act(() => { vi.advanceTimersByTime(1550); });
    expect(result.current.phase).toBe("idle");
  });

  it("queues rapid events and drains them", () => {
    const evt1 = makeRoundResult(1);
    const evt2 = makeRoundResult(2);
    const { result, rerender } = renderHook(
      ({ evt }) => useRoundAnimation(evt, "a", "b"),
      { initialProps: { evt: null as GameEvent | null } },
    );

    // Send first event
    rerender({ evt: evt1 });
    expect(result.current.phase).toBe("round-announce");
    expect(result.current.roundNo).toBe(1);

    // Send second while first is animating — should queue
    rerender({ evt: evt2 });
    // Still on round 1
    expect(result.current.roundNo).toBe(1);

    // Advance through entire first animation
    // round-announce(800) + choosing(1500) + reveal(1000) + clash(1000) + result(1500) = 5800
    act(() => { vi.advanceTimersByTime(5800); });
    // drain delay 50ms
    act(() => { vi.advanceTimersByTime(50); });

    // Now should be processing round 2 with fast durations
    expect(result.current.roundNo).toBe(2);
    expect(result.current.phase).toBe("round-announce");
  });

  it("match-end preempts queued rounds", () => {
    const evt1 = makeRoundResult(1);
    const matchEnd = makeMatchFinished();
    const { result, rerender } = renderHook(
      ({ evt }) => useRoundAnimation(evt, "agent-a", "agent-b"),
      { initialProps: { evt: null as GameEvent | null } },
    );

    // Start round animation
    rerender({ evt: evt1 });
    expect(result.current.phase).toBe("round-announce");

    // Send match end — should preempt
    rerender({ evt: matchEnd });
    expect(result.current.phase).toBe("match-end");
    expect(result.current.winnerId).toBe("agent-a");
  });

  it("uses reduced-motion fast path", () => {
    mockReducedMotion(true);
    const event = makeRoundResult(1);
    const { result, rerender } = renderHook(
      ({ evt }) => useRoundAnimation(evt, "a", "b"),
      { initialProps: { evt: null as GameEvent | null } },
    );

    rerender({ evt: event });
    // Should jump straight to result (no intermediate phases)
    expect(result.current.phase).toBe("result");
    expect(result.current.moveA).toBe(Move.ROCK);
    expect(result.current.moveB).toBe(Move.SCISSORS);

    // After 600ms should drain to idle
    act(() => { vi.advanceTimersByTime(650); });
    expect(result.current.phase).toBe("idle");
  });
});
