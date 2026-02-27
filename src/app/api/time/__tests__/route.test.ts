import { describe, it, expect } from "vitest";
import { GET } from "../route";

describe("GET /api/time", () => {
  it("returns server time in ISO 8601", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timezone).toBe("UTC");
    expect(new Date(body.serverTime).toISOString()).toBe(body.serverTime);
  });
});
