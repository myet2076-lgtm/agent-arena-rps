import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { RULES } = await import("@/types");
    const { db } = await import("@/lib/server/in-memory-db");
    const { testRedisConnection } = await import("@/lib/server/redis");
    await db.ensureLoaded();
    const redisOk = await testRedisConnection();
    return NextResponse.json({ ok: true, rules: !!RULES, agents: db.agentCount(), redis: redisOk });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: String(e), stack: (e as Error)?.stack?.slice(0, 1000) }, { status: 500 });
  }
}
