import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { db } = await import("@/lib/server/in-memory-db");
    await db.ensureLoaded();
    
    const body = await req.json();
    const name = body?.name;
    
    // Manual minimal registration to find the error
    const { hashApiKey, generateApiKey } = await import("@/lib/server/auth");
    const agentId = "agent-" + name.toLowerCase().replace(/[^a-z0-9]/g, "");
    
    const existing = db.getAgent(agentId);
    if (existing) {
      return NextResponse.json({ debug: "agent exists", id: existing.id, status: existing.status });
    }
    
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    
    // Try createAgent
    db.createAgent({ id: agentId, name, keyHash, elo: 1500 });
    await db.flush();
    
    // Verify it was saved
    const verify = db.getAgent(agentId);
    const verifyByHash = db.getAgentByKeyHash(keyHash);
    
    return NextResponse.json({
      ok: true,
      agentId,
      apiKey,
      savedInMemory: !!verify,
      foundByHash: !!verifyByHash,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e), stack: (e as Error)?.stack?.slice(0, 800) }, { status: 500 });
  }
}
