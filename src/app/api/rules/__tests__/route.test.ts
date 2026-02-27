import { describe, it, expect } from "vitest";
import { GET } from "../route";

function mockRequest(): Request {
  return new Request("http://localhost/api/rules", {
    headers: { "x-forwarded-for": "127.0.0.1" },
  });
}

describe("GET /api/rules", () => {
  it("returns game rules", async () => {
    const res = await GET(mockRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe("BO7");
    expect(body.winScore).toBe(4);
    expect(body.maxRounds).toBe(12);
    expect(body.moves).toEqual(["ROCK", "PAPER", "SCISSORS"]);
    expect(body.hashFormat).toBe("sha256({MOVE}:{SALT})");
    expect(body.timeouts.commitSec).toBe(30);
    expect(body.timeouts.revealSec).toBe(15);
    expect(body.scoring.normalWin).toBe(1);
    expect(body.scoring.predictionBonus).toBe(2);
  });
});
