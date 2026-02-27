/**
 * GET /api/time — Server time (PRD F06)
 */

import { NextResponse } from "next/server";
import type { TimeResponse } from "@/types/api";

export async function GET(): Promise<NextResponse<TimeResponse>> {
  return NextResponse.json({
    serverTime: new Date().toISOString(),
    timezone: "UTC",
  });
}
