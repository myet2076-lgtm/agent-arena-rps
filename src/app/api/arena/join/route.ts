/**
 * POST /api/arena/join — One-shot endpoint: register + auto-qualify + join queue
 *
 * Body: { name: string, description?: string, authorEmail?: string, avatarUrl?: string }
 * Returns: { agentId, name, apiKey, status, elo, position, estimatedWaitSec, queueId }
 *
 * If the agent name already exists and a valid apiKey is provided via x-agent-key header,
 * skips registration and just re-queues the existing agent.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/server/in-memory-db";
import { generateApiKey, hashApiKey, authenticateByKey } from "@/lib/server/auth";
import { ApiError, handleApiError } from "@/lib/server/api-error";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { checkIpRegistrationLimit, recordIpRegistration } from "@/lib/server/registration-tracker";
import { joinQueue } from "@/lib/services/queue-service";
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

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = checkRateLimit(null, ip);
  if (!rl.allowed) return rl.response!;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    throw new ApiError(400, "INVALID_NAME", "name is required");
  }

  const name = body.name.trim();
  if (name.length < 3 || name.length > 32) {
    throw new ApiError(400, "INVALID_NAME", "name must be 3-32 characters");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9]*(-[a-zA-Z0-9]+)*$/.test(name)) {
    throw new ApiError(400, "INVALID_NAME", "name must start with alphanumeric, no trailing/consecutive hyphens");
  }

  if (typeof body.description === "string" && body.description.length > 500) {
    throw new ApiError(400, "INVALID_INPUT", "description must be 500 characters or less");
  }
  if (typeof body.avatarUrl === "string" && (body.avatarUrl.length > 2048 || !/^https?:\/\//.test(body.avatarUrl))) {
    throw new ApiError(400, "INVALID_INPUT", "avatarUrl must be a valid HTTP(S) URL under 2048 chars");
  }

  let agent = db.getAgentByName(name);
  let rawKey: string | null = null;
  let isNewAgent = false;

  if (agent) {
    // Existing agent — authenticate with API key
    const auth = await authenticateByKey(req);
    if (!auth.valid || auth.agentId !== agent.id) {
      throw new ApiError(409, "NAME_TAKEN", "An agent with this name already exists. Provide the correct x-agent-key header to re-join.");
    }
  } else {
    // New agent — register
    const ipCheck = checkIpRegistrationLimit(ip);
    if (!ipCheck.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "Too many registrations from this IP", {
        retryAfter: ipCheck.retryAfterSec,
      });
    }

    const authorEmail = body.authorEmail as string | undefined;
    if (typeof authorEmail === "string" && authorEmail.length > 0) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorEmail)) {
        throw new ApiError(400, "INVALID_NAME", "authorEmail must be a valid email address");
      }
      const agentsByEmail = db.listAgents().filter((a: AgentRecord) => a.authorEmail === authorEmail);
      if (agentsByEmail.length >= 5) {
        throw new ApiError(429, "REGISTRATION_LIMIT", "Maximum 5 agents per email address");
      }
    }

    const slug = slugify(name);
    const agentId = `agent-${slug}`;
    rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const nowDate = new Date();

    agent = {
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
    } as AgentRecord;

    // Guard against slug collision (e.g., "abc" and "abc-" both slug to "abc")
    if (db.getAgent(agentId)) {
      throw new ApiError(409, "NAME_TAKEN", "An agent with a similar name already exists (ID collision).");
    }

    db.createAgent(agent);
    recordIpRegistration(ip);
    isNewAgent = true;
  }

  // Auto-qualify if not already qualified
  const qualifiableStatuses = new Set<string>([
    AgentStatus.REGISTERED,
    AgentStatus.QUALIFYING,
  ]);
  if (qualifiableStatuses.has(agent.status)) {
    const now = new Date();
    db.updateAgent({
      ...agent,
      status: AgentStatus.QUALIFIED,
      qualifiedAt: now,
      updatedAt: now,
    });
    agent = db.getAgent(agent.id)!;
  }

  // Join queue if eligible
  const queueableStatuses = new Set<string>([
    AgentStatus.QUALIFIED,
    AgentStatus.POST_MATCH,
  ]);

  let queueResult: { position: number; estimatedWaitSec: number; queueId: string } | null = null;

  if (queueableStatuses.has(agent.status)) {
    try {
      queueResult = joinQueue(agent.id);
    } catch (e) {
      if (e instanceof ApiError && (e.code === "ALREADY_IN_QUEUE" || e.code === "QUEUE_COOLDOWN")) {
        // Not fatal — just can't queue right now
        queueResult = null;
      } else {
        throw e;
      }
    }
  }

  await db.flush();

  // Re-fetch final state
  agent = db.getAgent(agent.id)!;

  const response: Record<string, unknown> = {
    agentId: agent.id,
    name: agent.name,
    status: agent.status,
    elo: agent.elo,
    createdAt: agent.createdAt.toISOString(),
    isNewAgent,
  };

  if (rawKey) {
    response.apiKey = rawKey;
    response.message = "Agent registered, qualified, and queued. Save your apiKey — it won't be shown again.";
  } else {
    response.message = "Agent re-queued for next match.";
  }

  if (queueResult) {
    response.position = queueResult.position;
    response.estimatedWaitSec = queueResult.estimatedWaitSec;
    response.queueId = queueResult.queueId;
  }

  return NextResponse.json(response, { status: isNewAgent ? 201 : 200 });
});
