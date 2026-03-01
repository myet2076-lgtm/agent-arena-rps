import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Test bare minimum - just types import
    const { RULES } = await import("@/types");
    return NextResponse.json({ ok: true, rules: !!RULES });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: String(e), stack: (e as Error)?.stack?.slice(0, 500) }, { status: 500 });
  }
}
