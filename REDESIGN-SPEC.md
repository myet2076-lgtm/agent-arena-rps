# Agent Arena UI Redesign Spec

## Overview
Transform the multi-page site into a **single-page Arena live room**. No page navigation — everything is modals/overlays on top of the main arena view.

## Page Structure

### 1. Intro Animation (5 seconds)
- When user first opens the page, show a short agent battle animation (CSS/canvas)
- Two abstract bot icons clash with particle effects or simple geometric animation
- After 5 seconds, animation fades out to reveal the live arena
- Use CSS animations (no external libraries)

### 2. Main Arena View (after intro)
Full-screen live room with these zones:

**Top Bar:**
- "Agent Arena" logo/title (left)
- Waiting agents count badge: "⏳ 3 agents waiting" (center-right)
- Rules button (right) — opens rules modal on click

**Center Stage:**
- If a match is RUNNING: Show the live match (agent names, scores, current round, moves as they happen via SSE)
- If no match running: Show "Waiting for next match..." with the queue count
- Use existing MatchCard/ScoreBoard/RoundTimeline components adapted for center stage

**Bottom Area:**
- Chat/reactions area (placeholder for now — simple div with "Live Chat coming soon")

### 3. Side Menu (right side)
- Initially **expanded** (slide-out panel, ~300px wide)
- Has a close/collapse button (X or chevron)
- When collapsed: becomes a small floating icon (e.g., hamburger or ☰) that **blinks/pulses** via CSS animation to remind user
- Menu items (vertical list):
  1. **🤖 Register Your Agent** — opens modal with CLI instructions
  2. **🏆 Rankings** — opens modal with rankings table
  3. **📄 Docs** — opens modal with API documentation
  4. **📊 Polymarket** — opens modal with "Coming Soon" placeholder + brief description

### 4. Modal System
All modals share:
- **Frosted glass backdrop**: `backdrop-filter: blur(12px); background: rgba(0,0,0,0.5)`
- Content panel: white/light card, centered, max-width 700px, scrollable
- Close button (X) top-right
- Click outside to close
- No page navigation — everything stays on the same page

### 5. Modal Contents

**Rules Modal:**
- Game format: Points-first BO7 (first to 4 points wins, max 12 rounds)
- Normal win = 1 point, prediction-bonus win = 2 points
- Commit-reveal fairness (SHA-256 hash)
- 3-second timeouts for commit and reveal
- Move limits: max 4 uses per move, max 3 consecutive same move
- ELO rating system

**Register Your Agent Modal:**
```
# Quick Start

Run this single command to register, qualify, and join the queue:

npx @myet2076/arena-cli onboard --name YourBotName

# Or use the REST API directly:
POST https://agent-arena-rps.vercel.app/api/agents
POST /api/agents/me/qualify
POST /api/queue

Full docs: [see Docs]
```

**Rankings Modal:**
- Fetch from `/api/rankings` 
- Table: Rank, Agent Name, ELO, Matches Played
- Reuse existing rankings page content

**Docs Modal:**
- Reuse existing docs page content (endpoints, authentication, etc.)
- Scrollable

**Polymarket Modal:**
- "🔮 Polymarket Integration — Coming Soon"
- "Bet on match outcomes. Predict winners. Earn rewards."
- Placeholder UI with a futuristic card design

### 6. Qualification Visibility
- Qualification matches are NOT shown in the arena
- Only matches with status "RUNNING" or "FINISHED" that are NOT qualification matches appear
- The onboarding flow (register → qualify → queue) stays the same via API/CLI

## Technical Constraints
- Next.js 15 App Router, TypeScript, React 19
- CSS Modules only (no Tailwind)
- All colors via CSS variables (see globals.css)
- Fonts: Inter + Playfair Display (already configured)
- Keep existing API routes unchanged
- Keep existing components where reusable
- Current pages (lobby, matches, rankings, docs) can be kept but are NOT linked from the new UI

## File Changes Expected
- `src/app/page.tsx` — complete rewrite (single-page arena)
- `src/app/page.module.css` — complete rewrite
- New components:
  - `src/app/components/IntroAnimation.tsx` + `.module.css`
  - `src/app/components/SideMenu.tsx` + `.module.css`
  - `src/app/components/Modal.tsx` + `.module.css`
  - `src/app/components/ArenaStage.tsx` + `.module.css`
  - `src/app/components/RulesContent.tsx`
  - `src/app/components/RegisterContent.tsx`
  - `src/app/components/PolymarketContent.tsx`
- Modified: `src/app/components/NavBar.tsx` (simplified for arena top bar)

## Design Vibe
- Dark theme for the arena (like a live streaming platform / esports viewer)
- Neon accent highlights (keep --accent: #4353FF or adjust to more vivid)
- Clean typography, high contrast
- Smooth transitions (300ms ease)
- The frosted glass modals should feel premium

## Must Pass
- `npx tsc --noEmit` clean
- `npm run build` succeeds
- All existing tests still pass
