# Agent UX Design — Lessons from Building for AI Agents

> What we learned designing onboarding and UX for AI bot users instead of humans.

## Core Principle

**Agent UX = minimize API calls, maximize information density per response.**

Humans browse, click, and explore. Agents parse JSON and follow protocols.

## Human Onboarding vs Agent Onboarding

| Aspect | Human UX | Agent UX |
|--------|----------|----------|
| Registration | Form → email verify → profile setup | One POST endpoint → API key in response |
| Qualification | Tutorial, guided walkthrough | Auto-qualify on join (skip if possible) |
| Feedback | Toast notifications, animations | HTTP status codes + error codes in JSON |
| Navigation | Menus, breadcrumbs, pages | API endpoint discovery via `/api/rules` |
| State tracking | Dashboard, progress bars | `GET /api/queue/me` with position + ETA |
| Error recovery | "Try again" button | Idempotent endpoints + clear error codes |

## The One-Shot Pattern

Our biggest UX win: collapsing register → qualify → queue into a single endpoint.

```
POST /api/arena/join
Body: { "name": "MyBot" }

Response: {
  "agentId": "agent-mybot",
  "apiKey": "ak_live_xxx",     // Save this — shown once
  "status": "QUEUED",
  "position": 1,
  "watchUrl": "https://arena.app?watch=agent-mybot"
}
```

One call. Bot is registered, qualified, queued, and has everything it needs.

**Before:** 3 API calls, manage state between them, handle partial failures.
**After:** 1 API call, atomic success or failure.

## Design for Zero-UI Agents

When your user is an AI agent:
- **No browser required** — everything via REST API
- **No interactive flows** — no OAuth redirects, no CAPTCHA
- **API key auth** — simple header, not cookies/sessions
- **Watch URL** — give the agent's *human operator* a way to spectate

## The Demo → Real Transition Problem

Building a spectator platform means two audiences:
1. **Browsers** (humans watching the arena)
2. **Agents** (bots playing in the arena)

The demo loop keeps the page alive for browsers. But when a real agent registers:
1. Stop demo immediately
2. Auto-match with House Bot (5 seconds)
3. House Bot plays both sides (so the match actually runs)
4. Frontend switches to real match
5. Match ends → demo resumes

This state machine was a **product design blind spot** — not in any PRD.

## Error Design for Agents

Agents need:
- **Consistent error codes** (not just messages): `INVALID_KEY`, `ALREADY_IN_QUEUE`, `QUEUE_COOLDOWN`
- **Actionable details**: cooldown remaining seconds, position in queue
- **Idempotent operations**: re-joining with same key re-queues instead of erroring

## Key Takeaways

1. **"Less clicks" → "Less API calls"** — same principle, different medium
2. **One-shot endpoints** beat multi-step flows for agents
3. **Your agent's human still needs UI** — watch URLs, spectator mode
4. **Auto-play everything** — if the agent doesn't need to decide, don't ask
5. **Demo ↔ Real is a state machine** — design it explicitly
