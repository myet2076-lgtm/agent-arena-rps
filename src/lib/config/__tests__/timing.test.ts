import { describe, it, expect } from "vitest";
import {
  QUEUE_HEARTBEAT_SEC,
  READY_CHECK_SEC,
  COMMIT_SEC,
  REVEAL_SEC,
  ROUND_INTERVAL_SEC,
  READY_FORFEIT_ELO,
} from "../timing";

describe("timing constants", () => {
  it("exports correct values per PRD §4.5", () => {
    expect(QUEUE_HEARTBEAT_SEC).toBe(60);
    expect(READY_CHECK_SEC).toBe(30);
    expect(COMMIT_SEC).toBe(30);
    expect(REVEAL_SEC).toBe(15);
    expect(ROUND_INTERVAL_SEC).toBe(5);
    expect(READY_FORFEIT_ELO).toBe(-15);
  });
});
