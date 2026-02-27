/**
 * Unified API Error handling (PRD §2.4, F07)
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/server/in-memory-db";


export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toResponse(): NextResponse {
    const headers: Record<string, string> = {};
    if (this.status === 429) {
      const retryAfter = this.details?.retryAfter ?? this.details?.retryAfterSec ?? 1;
      headers["Retry-After"] = String(retryAfter);
    }
    return NextResponse.json(
      {
        error: this.code,
        message: this.message,
        details: this.details ?? {},
      },
      { status: this.status, headers },
    );
  }
}

/**
 * Wrap a route handler to catch errors and return unified error responses.
 * Never leaks stack traces. 500 errors are logged internally.
 */
export function handleApiError(
  handler: (req: any, ...args: any[]) => Promise<NextResponse | Response>,
): (req: any, ...args: any[]) => Promise<NextResponse | Response> {
  return async (req: any, ...args: any[]) => {
    try {
      await db.ensureLoaded();
      return await handler(req, ...args);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        return err.toResponse();
      }

      // Log internally but never leak to client
      console.error("[API Error]", err);

      return NextResponse.json(
        { error: "INTERNAL_ERROR", message: "An unexpected error occurred", details: {} },
        { status: 500 },
      );
    }
  };
}
