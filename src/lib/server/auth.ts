/** MVP agent authentication via API key header */
const AGENT_KEYS: Record<string, string> = {
  "agent-a": process.env.AGENT_A_KEY || "dev-key-a",
  "agent-b": process.env.AGENT_B_KEY || "dev-key-b",
};

export function verifyAgentAuth(request: Request, agentId: string): { valid: boolean; error?: string } {
  const apiKey = request.headers.get("x-agent-key");
  if (!apiKey) return { valid: false, error: "Missing x-agent-key header" };

  const expected = AGENT_KEYS[agentId];
  if (!expected) return { valid: false, error: "Unknown agent" };

  // Constant-time comparison for production
  if (apiKey !== expected) return { valid: false, error: "Invalid API key" };

  return { valid: true };
}
