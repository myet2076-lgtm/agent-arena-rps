import { describe, it, expect, vi } from "vitest";
import { ApiError, handleApiError } from "../api-error";
import { NextResponse } from "next/server";

describe("ApiError", () => {
  it("creates error with status, code, message", () => {
    const err = new ApiError(400, "BAD_REQUEST", "Missing field");
    expect(err.status).toBe(400);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("Missing field");
  });

  it("toResponse returns correct JSON", async () => {
    const err = new ApiError(409, "CONFLICT", "Already exists", { field: "name" });
    const res = err.toResponse();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({
      error: "CONFLICT",
      message: "Already exists",
      details: { field: "name" },
    });
  });
});

describe("handleApiError", () => {
  it("passes through successful responses", async () => {
    const handler = handleApiError(async () => NextResponse.json({ ok: true }));
    const res = await handler(new Request("http://localhost"));
    expect(res.status).toBe(200);
  });

  it("catches ApiError and returns formatted response", async () => {
    const handler = handleApiError(async () => {
      throw new ApiError(404, "NOT_FOUND", "Not found");
    });
    const res = await handler(new Request("http://localhost"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("NOT_FOUND");
  });

  it("catches unknown errors and returns 500 without stack", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = handleApiError(async () => {
      throw new Error("kaboom");
    });
    const res = await handler(new Request("http://localhost"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("INTERNAL_ERROR");
    expect(body.message).not.toContain("kaboom");
    consoleSpy.mockRestore();
  });
});
