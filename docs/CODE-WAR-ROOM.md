# Code War Room — Multi-Model Development Workflow

> A battle-tested workflow for building production software with AI agents as your development team.

## Overview

The Code War Room is a structured multi-model collaboration pattern where different AI models play distinct roles in the software development lifecycle. Instead of one model doing everything, each model's strengths are leveraged in a write → review → iterate loop.

## The Loop

```
Claude writes code → Codex reviews + scores → Claude fixes → Codex re-reviews → ... → Ship when ≥ 8.5/10
```

### Rules

- **Minimum 4 review rounds** per phase (write + review = 1 round)
- Codex outputs: **score (/10) + specific issue list** each round
- **≥ 8.5/10 to ship** — otherwise keep iterating
- If still < 8.5 after R4, continue R5, R6... until passing

### Roles

| Role | Model | Responsibility |
|------|-------|----------------|
| **Writer** | Claude (sub-agent) | Write code, fix issues from review |
| **Reviewer** | Codex (sub-agent) | Review + score. Criteria: functionality, code quality, test coverage, edge cases |
| **Orchestrator** | E.T. (main agent) | Coordinate handoffs, pass review results to Writer, final acceptance |

### What Each Model Catches

- **Codex strengths**: API contract gaps, missing error codes, race conditions, idempotency issues, timeout edge cases, data model completeness
- **Claude strengths**: Architecture design, code structure, UX friction, feature completeness, naming/positioning

### Execution Principles

1. **Fully autonomous, no pauses** — once triggered, runs end-to-end without asking "should I continue?"
2. **Auto-chain mechanism** — each sub-agent completion triggers the next step in the same response
3. **Phase independence** — Phase N ships → Phase N+1 starts automatically
4. **Full context in prompts** — Writer task must include: PRD summary + current code state + previous review issues
5. **Scoped reviews** — Reviewer prompt must specify: "review ONLY these files/changes"
6. **Audit trail** — record runId + actual model per round for accountability
7. **Score trend tracking** — R1 → R2 → R3 → R4 (ensure continuous improvement)

## Results from Agent Arena RPS

| Phase | Description | Rounds | Final Score |
|-------|-------------|--------|-------------|
| Phase 1 | Japanese arcade visual overhaul | 4 | 9.5/10 |
| Phase 2 | Battle animations + SSE | 4 | 9.3/10 |
| Phase 3 | Sound effects + polish | 4 | 9.4/10 |
| Phase 4 | Prediction Center | 4 | 9.6/10 |
| Hardening | API audit + fixes | 4 | 9.4/10 |
| Features | House Bot + Watch URL + Victory | 2 | 9.0/10 |

**Total: 22 sub-agents, 133 files, ~15.8k LOC, 198 tests**

## Dual-Model Review Pattern (for Documents)

The same principle applies to documents, PRDs, and specs:

```
Write doc → Product review (UX/feature focus) → Codex review (contract/edge-case focus) → Synthesize → Rewrite
```

Document quality jumps significantly: v1 6.5/10 → v3 8+/10.

## Key Lessons

1. **Different models catch different blind spots** — no single model is sufficient
2. **Scoring creates accountability** — without a number, "looks good" means nothing
3. **4 rounds minimum is the sweet spot** — R1-R2 catch obvious issues, R3-R4 catch subtle ones
4. **Auto-chaining is critical** — human-in-the-loop between rounds kills momentum
5. **Scoped reviews > full codebase reviews** — focus the reviewer on what changed
