/**
 * POST /api/agents — Agent registration (PRD F01)
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/server/in-memory-db";
import { generateApiKey, hashApiKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { checkIpRegistrationLimit, recordIpRegistration } from "@/lib/server/registration-tracker";
import { AgentStatus, DEFAULT_AGENT_SETTINGS } from "@/types";
import type { AgentRecord } from "@/types";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const POST = handleApiError(async (req: Request) => {
  await db.ensureLoaded();

  // Rate limit by IP (public endpoint)
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(null, ip);
  if (!rl.allowed) return rl.response!;

  // Per-IP hourly cap (PRD F01)
  const ipCheck = checkIpRegistrationLimit(ip);
  if (!ipCheck.allowed) {
    throw new ApiError(429, "RATE_LIMITED", "Too many registrations from this IP", {
      retryAfter: ipCheck.retryAfterSec,
    });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    throw new ApiError(400, "INVALID_NAME", "name is required");
  }

  const name = body.name.trim();
  if (name.length < 3 || name.length > 32) {
    throw new ApiError(400, "INVALID_NAME", "name must be 3-32 characters");
  }

  // PRD F01: ^[a-zA-Z0-9][a-zA-Z0-9-]*$
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name)) {
    throw new ApiError(400, "INVALID_NAME", "name must start with alphanumeric and contain only letters, digits, and hyphens");
  }

  if (typeof body.description === "string" && body.description.length > 500) {
    throw new ApiError(400, "INVALID_NAME", "description must be 500 characters or less");
  }

  // authorEmail validation (PRD F01)
  const authorEmail = body.authorEmail as string | undefined;
  if (typeof authorEmail === "string" && authorEmail.length > 0) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorEmail)) {
      throw new ApiError(400, "INVALID_NAME", "authorEmail must be a valid email address");
    }

    // Per-email cap: max 5 agents per email (PRD F01)
    const agentsByEmail = db.listAgents().filter((a) => a.authorEmail === authorEmail);
    if (agentsByEmail.length >= 5) {
      throw new ApiError(429, "REGISTRATION_LIMIT", "Maximum 5 agents per email address");
    }
  }

  if (db.getAgentByName(name)) {
    throw new ApiError(409, "NAME_TAKEN", "An agent with this name already exists");
  }

  const slug = slugify(name);
  const agentId = `agent-${slug}`;
  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const nowDate = new Date();

  const agent: AgentRecord = {
    id: agentId,
    name,
    keyHash,
    status: AgentStatus.REGISTERED,
    elo: 1500,
    description: body.description ?? undefined,
    authorEmail: authorEmail ?? undefined,
    avatarUrl: body.avatarUrl ?? undefined,
    createdAt: nowDate,
    updatedAt: nowDate,
    queueCooldownUntil: null,
    queueBanUntil: null,
    consecutiveTimeouts: 0,
    suspiciousFlag: false,
    settings: { ...DEFAULT_AGENT_SETTINGS },
    consecutiveMatches: 0,
    consecutiveQualFails: 0,
    qualifiedAt: null,
    lastQualFailAt: null,
  };

  db.createAgent(agent);
  await db.flush();
  recordIpRegistration(ip);

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
