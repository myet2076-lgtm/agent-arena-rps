import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { db } = await import("@/lib/server/in-memory-db");
    const { loadFromRedis } = await import("@/lib/server/redis");
    
    await db.ensureLoaded();
    const agentCount = db.agentCount();
    
    // Direct Redis read
    const raw = await loadFromRedis();
    const redisAgentCount = raw?.agents ? Object.keys(raw.agents as Record<string, unknown>).length : 0;
    const redisAgentIds = raw?.agents ? Object.keys(raw.agents as Record<string, unknown>).slice(0, 10) : [];
    
    // Check a specific agent
    const url = new URL(req.url);
    const checkId = url.searchParams.get("agent");
    let agentInfo = null;
    if (checkId) {
      const agent = db.getAgent(checkId);
      agentInfo = agent ? { id: agent.id, name: agent.name, hasKeyHash: !!agent.keyHash, status: agent.status } : "NOT_FOUND";
    }
    
    return NextResponse.json({ 
      memoryAgents: agentCount,
      redisAgents: redisAgentCount,
      redisAgentIds,
      agentInfo,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
