import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, resetRateLimiter } from "../rate-limiter";

describe("rate-limiter", () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it("allows requests under the limit", () => {
    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit("key-1", "1.2.3.4");
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks API key after 10 req/s", () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit("key-1", "1.2.3.4");
    }
    const result = checkRateLimit("key-1", "1.2.3.4");
    expect(result.allowed).toBe(false);
    expect(result.response?.status).toBe(429);
  });

  it("blocks IP after 30 req/s for public endpoints", () => {
    for (let i = 0; i < 30; i++) {
      checkRateLimit(null, "1.2.3.4");
    }
    const result = checkRateLimit(null, "1.2.3.4");
    expect(result.allowed).toBe(false);
  });

  it("includes Retry-After header on 429", async () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit("key-1", "1.2.3.4");
    }
    const result = checkRateLimit("key-1", "1.2.3.4");
    expect(result.response?.headers.get("Retry-After")).toBeTruthy();
  });

  it("different keys have independent limits", () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit("key-1", "1.2.3.4");
    }
    const result = checkRateLimit("key-2", "1.2.3.4");
    expect(result.allowed).toBe(true);
  });
});
