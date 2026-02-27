import { describe, it, expect, beforeEach } from "vitest";
import { resolveReady, resolveRound, resetScheduler } from "../match-scheduler";

beforeEach(() => {
  resetScheduler();
});

describe("Resolution Locks", () => {
  it("resolveReady — first call true, second false", () => {
    expect(resolveReady("m1")).toBe(true);
    expect(resolveReady("m1")).toBe(false);
    expect(resolveReady("m1")).toBe(false);
  });

  it("resolveReady — different matches resolve independently", () => {
    expect(resolveReady("m1")).toBe(true);
    expect(resolveReady("m2")).toBe(true);
    expect(resolveReady("m1")).toBe(false);
    expect(resolveReady("m2")).toBe(false);
  });

  it("resolveRound — first call true, second false", () => {
    expect(resolveRound("m1", 1)).toBe(true);
    expect(resolveRound("m1", 1)).toBe(false);
  });

  it("resolveRound — different rounds resolve independently", () => {
    expect(resolveRound("m1", 1)).toBe(true);
    expect(resolveRound("m1", 2)).toBe(true);
    expect(resolveRound("m1", 3)).toBe(true);
    expect(resolveRound("m1", 1)).toBe(false);
  });

  it("resolveRound — different matches same round resolve independently", () => {
    expect(resolveRound("m1", 1)).toBe(true);
    expect(resolveRound("m2", 1)).toBe(true);
    expect(resolveRound("m1", 1)).toBe(false);
  });

  it("concurrent safety — simulated rapid calls", () => {
    const results: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(resolveRound("concurrent", 1));
    }
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[0]).toBe(true);
  });
});
