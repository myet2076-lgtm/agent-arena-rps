# Feature: Complete Battle Flow — End-to-End Visual Experience

## Background
The frontend currently cannot display a complete, smooth battle flow (demo or real). Kevin reports the experience is broken — matches don't show full rounds, transitions are jarring, and the flow feels incomplete.

Root causes:
1. **Dual demo system**: Server-side `startDemoLoop()` and client-side `useClientDemo` compete, causing flickering between `ArenaStage` and `ClientDemoStage`.
2. **Timing mismatch**: Server demo plays rounds every ~3.5s, page polls `/api/matches` every 4s — frontend often misses running matches entirely.
3. **SSE replay chaos**: When `ArenaStage` connects to a mid-flight match, it replays all buffered events in fast mode — animations pile up and look broken.
4. **No match-to-match transition**: When a match finishes, UI jumps from ArenaStage → ClientDemoStage → ArenaStage with no visual continuity.

## Requirements
1. Viewer sees complete battle animations from Round 1 through MATCH_FINISHED for every match (demo or real).
2. Smooth transition between consecutive matches (no flickering, no blank states).
3. On Railway (persistent server): server demo is the single source of truth — client demo disabled.
4. On Vercel (no persistent server): client demo is the single source of truth — server demo unavailable.
5. When a viewer joins mid-match: show current score + "catching up" state, then animate remaining rounds live.
6. Build passes (`next build`), 196+ tests still pass.

## Design Decisions
- **D1**: Unify to ONE demo path per environment. Detect via a flag (e.g., `/api/health` returns `{ persistent: true }`) or simply: if SSE connects and gets real events, stay on `ArenaStage`; otherwise fall back to `ClientDemoStage`.
- **D2**: Slow down server demo pacing. Use 5s round interval (from 3.5s) + 2s pre-match warm-up delay so frontend poll reliably catches RUNNING state.
- **D3**: For mid-match join: show static scoreboard immediately from match detail API, then only animate new incoming events (don't replay old rounds as animations).
- **D4**: Add a "next match countdown" state between matches (3-5s) so the UI never shows a blank/loading flicker.
- **D5**: `page.tsx` poll interval → 2s (from 4s) for faster match detection.
- **D6**: Keep `useMatchSSE` and `normalizeEvent` largely intact — they work. The fix is in how we handle buffered/replayed events vs live events.

## Task Breakdown

### Task 1: Unify Demo Detection (parallel)
- **Files**: `src/app/page.tsx`, `src/app/api/health/route.ts`
- **Changes**: 
  - Add `persistent: boolean` field to `/api/health` response.
  - In `page.tsx`, fetch health on mount → set `isPersistentServer`. 
  - If persistent: never render `ClientDemoStage`, always use `ArenaStage` (even for demo matches).
  - If not persistent: use `ClientDemoStage` only.
- **Acceptance**: No more flickering between ArenaStage and ClientDemoStage on Railway.

### Task 2: Slow Down Server Demo + Add Warm-Up (parallel)
- **Files**: `src/lib/services/demo-match.ts`
- **Changes**:
  - Increase round interval sleep from 3500ms → 5000ms.
  - Add 3s "warm-up" sleep after match creation + ready check before first round.
  - Increase inter-match pause from 8000ms → 10000ms.
  - Emit `MATCH_STARTED` event with agent names at match creation (before rounds begin).
- **Acceptance**: Server demo matches take ~35-45s total, giving frontend reliable time to detect and display.

### Task 3: Fix Mid-Match Join — No Animation Replay (depends on Task 1)
- **Files**: `src/app/components/ArenaStage.tsx`, `src/app/hooks/useMatchSSE.ts`
- **Changes**:
  - `ArenaStage`: On initial load from `/api/matches/{id}`, render scored rounds directly in `RoundTimeline` (already works) and scoreboard (already works). Don't feed historical events into `useRoundAnimation`.
  - `useMatchSSE`: Add a `ready` flag — only emit events to `latestEvent` after initial SSE connection is established and replay is complete. Use the `STATE_SNAPSHOT` / connection comment as boundary marker.
  - `useRoundAnimation`: No changes needed — it only animates what `latestEvent` gives it.
- **Acceptance**: Joining a match at round 3 shows score 1-2 immediately, then animates round 4+ live.

### Task 4: Match-to-Match Transition State (depends on Task 1)
- **Files**: `src/app/page.tsx`, `src/app/components/ArenaStage.tsx` (or new `MatchTransition.tsx`)
- **Changes**:
  - After `MATCH_FINISHED` animation completes in `BattleStage`, keep displaying the result for 6s (already happens via `match-end` phase duration).
  - In `page.tsx`, when `runningMatch` transitions from a finished match to null, show a "Next match starting soon..." interstitial for 3-5s instead of immediately jumping to ClientDemoStage/blank.
  - When the next match is detected, smoothly transition to it.
- **Acceptance**: No blank/loading flicker between matches. User sees "result → countdown → next match" flow.

### Task 5: Faster Polling + Connection Resilience (parallel)
- **Files**: `src/app/page.tsx`
- **Changes**:
  - Reduce match poll interval from 4000ms → 2000ms.
  - Add optimistic match detection: if SSE receives MATCH_START event while showing ClientDemoStage, switch immediately.
- **Acceptance**: Match detection delay ≤ 2s from match creation.

### Task 6: Integration Test — Full Cycle (depends on all above)
- **Files**: Manual verification + existing test suite
- **Changes**: Run `vitest` — 196+ tests pass. Run `next build` — no errors.
- **Acceptance**: Build clean, tests green, no regressions.

## Risk Points
- Changing polling/timing could affect real match detection. Mitigate: only change demo timing, not real match logic.
- `useMatchSSE` replay-suppression must not suppress events for new rounds. Key: use SSE connection establishment as boundary, not event count.
- `ClientDemoStage` removal on Railway must be clean — no memory leaks from orphaned timers.
