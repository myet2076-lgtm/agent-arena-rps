/**
 * POST /api/agents — Agent registration (PRD F01)
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/server/in-memory-db";
import { generateApiKey, hashApiKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { AgentStatus, DEFAULT_AGENT_SETTINGS } from "@/types";
import type { AgentRecord } from "@/types";

const MAX_AGENTS = 100;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const POST = handleApiError(async (req: Request) => {
  // Rate limit by IP (public endpoint)
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(null, ip);
  if (!rl.allowed) return rl.response!;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    throw new ApiError(400, "MISSING_NAME", "name is required");
  }

  const name = body.name.trim();
  if (name.length < 3 || name.length > 32) {
    throw new ApiError(400, "INVALID_NAME", "name must be 3-32 characters");
  }

  // PRD: ^[a-zA-Z0-9][a-zA-Z0-9 -]*$ (alphanumeric + spaces + hyphens)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 -]*$/.test(name)) {
    throw new ApiError(400, "INVALID_NAME", "name must start with alphanumeric and contain only letters, digits, spaces, and hyphens");
  }

  if (typeof body.description === "string" && body.description.length > 500) {
    throw new ApiError(400, "BAD_REQUEST", "description must be 500 characters or less");
  }

  if (db.getAgentByName(name)) {
    throw new ApiError(409, "NAME_TAKEN", "An agent with this name already exists");
  }

  if (db.agentCount() >= MAX_AGENTS) {
    throw new ApiError(429, "REGISTRATION_LIMIT", "Maximum number of agents reached");
  }

  const slug = slugify(name);
  const agentId = `agent-${slug}`;
  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const now = new Date();

  const agent: AgentRecord = {
    id: agentId,
    name,
    keyHash,
    status: AgentStatus.REGISTERED,
    elo: 1500,
    description: body.description ?? undefined,
    avatarUrl: body.avatarUrl ?? undefined,
    createdAt: now,
    updatedAt: now,
    queueCooldownUntil: null,
    queueBanUntil: null,
    consecutiveTimeouts: 0,
    suspiciousFlag: false,
    settings: { ...DEFAULT_AGENT_SETTINGS },
    consecutiveMatches: 0,
    consecutiveQualFails: 0,
  };

  db.createAgent(agent);

  return NextResponse.json(
    {
      agentId: agent.id,
      name: agent.name,
      apiKey: rawKey,
      status: agent.status,
      elo: agent.elo,
      createdAt: agent.createdAt.toISOString(),
    },
    { status: 201 },
  );
});
