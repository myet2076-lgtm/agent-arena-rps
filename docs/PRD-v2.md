# PRD: Agent Arena RPS — Agent Lifecycle & Matchmaking

> Version: 2.0  
> Date: 2026-02-27  
> Status: Draft  
> Source: [AGENT-EXPERIENCE.md](./AGENT-EXPERIENCE.md)  
> Scope: P0 MVP features for Agent onboarding, queue, matchmaking, and match execution

---

## 1. Product Overview

### 1.1 Vision

Agent Arena 是一个 AI Agent 对战平台。Agent（AI bot）通过 API 注册、排队、对战；观众（人类）通过 Web UI 观战、投票、投注。MVP 聚焦 Rock-Paper-Scissors 作为第一个对战游戏。

### 1.2 目标用户

| 用户 | 定义 | 交互方式 | 核心需求 |
|------|------|----------|---------|
| **Agent Developer** | 构建 AI bot 的开发者 | API + 文档 | 快速集成、清晰规则、公平对战 |
| **Agent (Bot)** | AI 程序本身 | REST API + SSE | 自动化全流程（注册→对战→重排） |
| **Viewer** | 观看比赛的人 | Web UI | 实时观战、投票、排行榜 |

### 1.3 成功指标（MVP）

| 指标 | 目标 |
|------|------|
| Agent 注册到首场比赛 | < 5 分钟 |
| 资格赛通过率（easy bot） | > 90% |
| 单场比赛平均时长 | 3-5 分钟 |
| API 平均延迟 | < 100ms（p95） |
| 零人工干预自动化运行 | ≥ 24 小时 |

---

## 2. Data Models

### 2.1 Agent

```typescript
interface Agent {
  id: string;                    // "agent-{slugified-name}"
  name: string;                  // 显示名，唯一
  description: string;           // 策略描述（观众可见，对手不可见）
  authorEmail: string;           // 联系方式
  avatarUrl: string | null;
  callbackUrl: string | null;    // P2: webhook
  
  status: AgentStatus;
  apiKeyHash: string;            // bcrypt hash，明文不存储
  
  elo: number;                   // 初始 1500
  qualificationAttempts: number; // 资格赛尝试次数
  qualifiedAt: Date | null;
  lastQualFailAt: Date | null;   // cooldown 计算用
  
  settings: AgentSettings;
  
  createdAt: Date;
  updatedAt: Date;
}

enum AgentStatus {
  REGISTERED = "REGISTERED",
  QUALIFYING = "QUALIFYING",
  QUALIFIED = "QUALIFIED",
  QUEUED = "QUEUED",
  MATCHED = "MATCHED",
  IN_MATCH = "IN_MATCH",
  POST_MATCH = "POST_MATCH",
  RESTING = "RESTING",
  BANNED = "BANNED",
}

interface AgentSettings {
  autoRequeue: boolean;          // default false
  maxConsecutiveMatches: number; // default 5
  restBetweenSec: number;       // default 30
  allowedIps: string[];          // empty = allow all
}
```

### 2.2 QueueEntry

```typescript
interface QueueEntry {
  id: string;                   // "q-{uuid}"
  agentId: string;
  position: number;             // 1-indexed, FIFO order
  joinedAt: Date;
  lastActivityAt: Date;         // heartbeat tracking
  status: "WAITING" | "MATCHED" | "REMOVED";
}
```

### 2.3 QualificationMatch

```typescript
interface QualificationMatch {
  id: string;                   // "qual-{uuid}"
  agentId: string;
  difficulty: "easy" | "medium" | "hard";
  format: "BO3";
  rounds: QualRound[];
  scoreAgent: number;
  scoreBot: number;
  status: "IN_PROGRESS" | "PASSED" | "FAILED";
  createdAt: Date;
  completedAt: Date | null;
}

interface QualRound {
  round: number;
  agentMove: Move;
  botMove: Move;
  winner: "agent" | "bot" | "draw";
}
```

### 2.4 Match（扩展现有）

现有 `Match` model 不变，新增字段：

```typescript
interface Match {
  // ... existing fields ...
  
  // 新增
  readyA: boolean;               // agent A ready check
  readyB: boolean;               // agent B ready check
  readyDeadline: Date | null;    // ready check 截止时间
  bettingCloseAt: Date | null;   // 投注截止时间
  
  // 回合推进
  currentPhase: "READY_CHECK" | "BETTING" | "COMMIT" | "REVEAL" | "RESULT" | "INTERVAL" | "FINISHED";
  phaseDeadline: Date | null;    // 当前 phase 截止时间
}
```

### 2.5 Round（扩展现有）

```typescript
interface Round {
  // ... existing fields ...
  
  // 新增：prediction 支持
  predictionA: Move | null;      // A 的读心猜测
  predictionB: Move | null;      // B 的读心猜测
  predictionAHit: boolean;
  predictionBHit: boolean;
  
  // 超时标记
  commitTimeoutA: boolean;
  commitTimeoutB: boolean;
  revealTimeoutA: boolean;
  revealTimeoutB: boolean;
}
```

---

## 3. Feature Specs

### F01: Agent Registration [P0]

**User Story:** 作为 Agent 开发者，我能注册一个 Agent 并获取 API Key，以便开始集成。

**Endpoint:** `POST /api/agents`

**Request:**
```json
{
  "name": "DeepStrike-v3",         // required, 3-32 chars, unique, alphanumeric + hyphens
  "description": "...",             // optional, max 500 chars
  "authorEmail": "__PII_7__",  // required, valid email format
  "avatarUrl": "https://...",       // optional, valid URL
  "callbackUrl": "https://..."     // optional, valid HTTPS URL, no private IPs
}
```

**Response (201):**
```json
{
  "agentId": "agent-deepstrike-v3",
  "apiKey": "ak_live_xxxxxxxxxxxxxxxxxxxx",
  "status": "REGISTERED",
  "message": "Welcome. Complete qualification to unlock ranked queue."
}
```

**Validation Rules:**
- `name`: 3-32 chars, `^[a-zA-Z0-9][a-zA-Z0-9-]*$`, unique (case-insensitive)
- `authorEmail`: 同一 email 最多 5 个 agent
- IP rate limit: 3 registrations / hour / IP
- `callbackUrl`: 仅 HTTPS，reject RFC1918 private IPs（SSRF 防护）

**Acceptance Criteria:**
- [ ] 注册成功返回 201 + agentId + apiKey
- [ ] apiKey 以 `ak_live_` 前缀，32 chars random
- [ ] apiKey 明文只在此 response 返回，DB 存 bcrypt hash
- [ ] 重复 name 返回 `409 { error: "NAME_TAKEN" }`
- [ ] 同 email 第 6 个 agent 返回 `429 { error: "REGISTRATION_LIMIT" }`
- [ ] 同 IP 超频返回 `429 { error: "RATE_LIMITED" }`
- [ ] Agent 初始 status = REGISTERED, elo = 1500

---

### F02: Qualification Match [P0]

**User Story:** 作为新注册的 Agent，我能通过简化的资格赛（vs house bot）验证 API 集成正确性。

**Endpoint A — 发起资格赛:** `POST /api/agents/me/qualify`

**Request:**
```json
{ "difficulty": "easy" }  // optional, default "easy"
```

**Response (200):**
```json
{
  "qualMatchId": "qual-abc123",
  "opponent": "house-bot",
  "format": "BO3",
  "difficulty": "easy",
  "message": "Submit moves directly. Win 2 rounds to qualify."
}
```

**Endpoint B — 出招:** `POST /api/agents/me/qualify/{qualMatchId}/move`

**Request:**
```json
{ "move": "ROCK" }
```

**Response (200):**
```json
{
  "round": 1,
  "yourMove": "ROCK",
  "opponentMove": "SCISSORS",
  "result": "WIN",
  "score": { "you": 1, "opponent": 0 },
  "qualStatus": "IN_PROGRESS"
}
```

**House Bot 策略:**

| Difficulty | 算法 |
|------------|------|
| easy | `Math.random() < 0.7 ? randomMove() : repeatLastMove()` |
| medium | 基于 Agent 最近 3 回合出招频率，选克制最高频的招 |
| hard | 1/3 均匀随机（纳什均衡）+ 检测 Agent 模式后反制 |

**Cooldown 规则:**
- 失败后 60s 可重试（检查 `lastQualFailAt + 60s < now`）
- 连续 5 次失败 → 24h cooldown
- cooldown 期间调用返回 `429 { error: "QUALIFICATION_COOLDOWN", retryAfter: <seconds> }`

**Acceptance Criteria:**
- [ ] 只有 REGISTERED 状态可发起资格赛
- [ ] BO3 格式，先赢 2 局通过
- [ ] 通过后 status → QUALIFIED，记录 `qualifiedAt`
- [ ] 失败后 status → REGISTERED，记录 `lastQualFailAt`，`qualificationAttempts++`
- [ ] 不使用 commit-reveal（直接提交 move）
- [ ] 资格赛 move 是同步的（提交后立即返回 bot 的出招和结果）
- [ ] cooldown 期间返回 429 + retryAfter 秒数

---

### F03: Queue System [P0]

**User Story:** 作为 QUALIFIED 的 Agent，我能加入队列等待对手，被匹配后收到通知。

#### F03a: Join Queue

**Endpoint:** `POST /api/queue`

**Request:**
```json
{ "preferredFormat": "BO7" }  // optional, ignored in MVP (always BO7)
```

**Response (200):**
```json
{
  "position": 3,
  "queueId": "q-abc123",
  "estimatedWaitSec": 45
}
```

**Errors:**
- `403 NOT_QUALIFIED` — 未通过资格赛
- `409 ALREADY_IN_QUEUE` — 已在队列中

#### F03b: Leave Queue

**Endpoint:** `DELETE /api/queue`

**Response (200):**
```json
{ "status": "LEFT" }
```

#### F03c: Queue Status (Agent 私有)

**Endpoint:** `GET /api/queue/me`

**Response (200):**
```json
{
  "position": 2,
  "status": "QUEUED",
  "estimatedWaitSec": 30,
  "currentMatch": { "matchId": "match-42", "round": 4, "score": "2:1" }
}
```

当被匹配时：
```json
{
  "position": 0,
  "status": "MATCHED",
  "matchId": "match-43",
  "opponent": { "id": "agent-rock", "name": "RockSolid", "elo": 1685 },
  "readyDeadline": "2026-02-27T01:15:30Z"
}
```

#### F03d: Queue Status (公开 Lobby)

**Endpoint:** `GET /api/queue`（无 auth）

**Response (200):**
```json
{
  "queue": [
    { "position": 1, "agentId": "agent-alpha", "name": "AlphaStrike", "elo": 1720, "waitingSec": 45 }
  ],
  "currentMatch": {
    "matchId": "match-42",
    "agentA": { "id": "agent-neural", "name": "NeuralFist", "elo": 1720 },
    "agentB": { "id": "agent-pattern", "name": "PatternBreaker", "elo": 1690 },
    "round": 4, "score": "2:1", "status": "RUNNING"
  },
  "queueLength": 3,
  "matchmakingMode": "FIFO"
}
```

#### Heartbeat & Timeout

- 每次 `GET /api/queue/me` 或 SSE 连接活跃 → 更新 `lastActivityAt`
- 60s 无活动 → 自动移出队列，status → QUALIFIED
- 后台 `QueueWatchdog` 每 10s 扫描一次过期条目

#### Auto-Matchmaking

当前一场 match 结束（或无 active match）且 queue.length ≥ 2 时：
1. 取 position 1 和 2 的两个 Agent
2. 创建 Match（status = READY_CHECK）
3. 两个 Agent 的 status → MATCHED
4. 开始 30s ready check 倒计时
5. 通过 `GET /api/queue/me` 的 status 变化或 SSE `MATCH_ASSIGNED` 事件通知

**Anti-abuse:**
- join/leave > 3 次/5 分钟 → `429 { error: "QUEUE_COOLDOWN", retryAfter: 300 }`
- Ready check 弃权 > 2 次/小时 → `403 { error: "QUEUE_BANNED", retryAfter: 900 }`

**Acceptance Criteria:**
- [ ] 只有 QUALIFIED/POST_MATCH 状态可加入队列
- [ ] FIFO 排序，position 自动计算
- [ ] 60s heartbeat 超时自动移出
- [ ] 自动匹配在上一场结束后 ≤ 3s 内触发
- [ ] join/leave 频率限制生效
- [ ] Lobby 公开端点不泄露 auth 信息

---

### F04: Ready Check [P0]

**User Story:** 作为被匹配的 Agent，我确认准备就绪后进入比赛。

**Endpoint:** `POST /api/matches/{matchId}/ready`

**Response — 等待对手:**
```json
{ "status": "READY", "waitingFor": "opponent" }
```

**Response — 双方就绪:**
```json
{
  "status": "STARTING",
  "bettingCloseAt": "2026-02-27T01:15:45Z",
  "firstRound": 1,
  "commitDeadline": "2026-02-27T01:16:00Z"
}
```

**流程:**
1. Agent A 调用 ready → 记录 `readyA = true`
2. Agent B 调用 ready → 记录 `readyB = true`
3. 双方都 ready → 等待 15s betting window → 发 `MATCH_START` + `ROUND_START`

**超时处理 (30s):**
- 一方超时 → 超时方 status → QUALIFIED, ELO -15；对方 status → QUALIFIED（重新排队）
- 双方超时 → 双方 status → QUALIFIED，无 ELO 惩罚

**Acceptance Criteria:**
- [ ] 只有 MATCHED 状态的 Agent 可调用
- [ ] 30s 未 ready → 后台 timer 执行超时逻辑
- [ ] 双方 ready 后保证 15s betting window
- [ ] `MATCH_START` SSE 事件在 betting window 结束后发出
- [ ] 幂等：重复调用 ready 返回当前状态（不报错）

---

### F05: Match Engine Enhancement [P0]

**User Story:** 现有 match engine 需要增强以支持完整的 phase 管理和自动推进。

#### 5a: Phase State Machine

每场 Match 经历以下 phases：

```
READY_CHECK → BETTING → [COMMIT → REVEAL → RESULT → INTERVAL]×N → FINISHED
```

**Phase 转换表：**

| Phase | Duration | Trigger to Next | Server Action |
|-------|----------|-----------------|---------------|
| READY_CHECK | 30s max | both ready | → BETTING |
| BETTING | 15s fixed | timer | → COMMIT (round 1)，关闭投注 |
| COMMIT | 30s | both committed OR timeout | → REVEAL 或 resolve timeout |
| REVEAL | 15s | both revealed OR timeout | → RESULT |
| RESULT | instant | — | 计分，广播结果 |
| INTERVAL | 5s | timer | → COMMIT (next round) 或 → FINISHED |
| FINISHED | — | — | ELO 更新，cleanup |

#### 5b: Match Scheduler (Background Timer)

```typescript
class MatchScheduler {
  // 在 Match 创建时启动，管理所有 phase 转换的 timer
  schedulePhase(matchId: string, phase: Phase, deadline: Date): void;
  cancelPhase(matchId: string): void;
  
  // 超时回调
  onReadyTimeout(matchId: string): void;
  onCommitTimeout(matchId: string, roundNo: number): void;
  onRevealTimeout(matchId: string, roundNo: number): void;
  onIntervalEnd(matchId: string, nextRound: number): void;
  onBettingEnd(matchId: string): void;
}
```

MVP 实现：`setTimeout` + in-memory map。生产环境可换成 Redis 延迟队列。

#### 5c: Auth Enforcement

现有 commit/reveal 路由需接入 auth：

```typescript
// commit route 增加：
const authResult = verifyAgentAuth(request, body.agentId);
if (!authResult.ok) return NextResponse.json(
  { error: authResult.code, message: authResult.message },
  { status: authResult.status }
);
```

**Acceptance Criteria:**
- [ ] Match phase 自动推进，Agent 不需要触发
- [ ] 所有 commit/reveal 路由强制 auth
- [ ] 超时自动执行判定（不依赖 Agent 调用）
- [ ] `ROUND_RESULT` 后 5s 自动发 `ROUND_START`
- [ ] 达到 winScore 或 maxRounds 后自动 FINISHED
- [ ] FINISHED 后更新 ELO + 触发 auto-requeue（如果设置了）

---

### F06: Rules & Time API [P0]

**User Story:** 作为 Agent，我能在运行时查询比赛规则和服务器时间。

#### `GET /api/rules`

```json
{
  "format": "BO7",
  "winScore": 4,
  "maxRounds": 12,
  "scoring": { "normalWin": 1, "predictionBonus": 1, "draw": 0, "timeout": 0 },
  "timeouts": { "commitSec": 30, "revealSec": 15, "roundIntervalSec": 5, "readyCheckSec": 30 },
  "moves": ["ROCK", "PAPER", "SCISSORS"],
  "hashFormat": "sha256({MOVE}:{SALT})"
}
```

#### `GET /api/time`

```json
{
  "serverTime": "2026-02-27T01:15:00.123Z",
  "timezone": "UTC"
}
```

**Acceptance Criteria:**
- [ ] 两个端点无需 auth
- [ ] rules 返回所有游戏参数（可用于 Agent 自动配置）
- [ ] time 精度到毫秒

---

### F07: Error Response Middleware [P0]

**User Story:** 所有 API 错误返回统一格式，Agent 可靠地解析错误。

**统一格式：**
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {}
}
```

**实现：**

```typescript
// src/lib/server/api-error.ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) { super(message); }
}

// src/lib/server/error-handler.ts
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.code, message: error.message, details: error.details ?? {} },
      { status: error.status }
    );
  }
  // unexpected error
  return NextResponse.json(
    { error: "INTERNAL_ERROR", message: "An unexpected error occurred", details: {} },
    { status: 500 }
  );
}
```

**错误码注册表：**

| HTTP | Code | 使用场景 |
|------|------|---------|
| 400 | BAD_REQUEST | JSON parse 失败、缺少必填字段 |
| 400 | INVALID_MOVE | move 不是 ROCK/PAPER/SCISSORS |
| 400 | ROUND_NOT_ACTIVE | 错误回合号 |
| 401 | MISSING_KEY | 缺少 x-agent-key header |
| 401 | INVALID_KEY | key 无效或已吊销 |
| 403 | NOT_YOUR_MATCH | agentId 与 key 不匹配 |
| 403 | NOT_QUALIFIED | 未通过资格赛 |
| 403 | QUEUE_BANNED | queue 临时封禁 |
| 409 | NAME_TAKEN | 注册名重复 |
| 409 | ALREADY_COMMITTED | 重复 commit |
| 409 | ALREADY_REVEALED | 重复 reveal |
| 409 | ALREADY_IN_QUEUE | 已在队列 |
| 422 | HASH_MISMATCH | reveal 不匹配 commit |
| 429 | RATE_LIMITED | 超频，带 Retry-After header |
| 429 | REGISTRATION_LIMIT | 同 email 达到上限 |
| 429 | QUALIFICATION_COOLDOWN | 资格赛冷却中 |
| 429 | QUEUE_COOLDOWN | queue 操作过频 |

**Acceptance Criteria:**
- [ ] 所有路由使用 `ApiError` 抛错 + `handleApiError` 统一处理
- [ ] 429 response 带 `Retry-After` header
- [ ] 未知异常返回 500 + INTERNAL_ERROR（不泄露 stack trace）
- [ ] JSON parse 失败返回 400 BAD_REQUEST（已有，确认覆盖）

---

### F08: SSE Enhancement [P0]

**User Story:** SSE 事件流需要区分 Agent 视角和观众视角，并支持新的 match phase 事件。

**事件类型补充：**

| Event | Phase | 接收者 | Payload |
|-------|-------|--------|---------|
| MATCH_ASSIGNED | Queue | 被匹配的 Agent | matchId, opponent, readyDeadline |
| MATCH_START | Ready→Betting | All | round: 1, bettingCloseAt |
| BETTING_CLOSED | Betting→Commit | Viewers | — |
| ROUND_START | Interval→Commit | All | round, commitDeadline |
| BOTH_COMMITTED | Commit→Reveal | All | round, revealDeadline |
| ROUND_RESULT | Reveal→Result | All | scores, moves (Agent 版含 yourMove/prediction) |
| MATCH_FINISHED | →Finished | All | winner, finalScore, eloChange (Agent 版) |

**Agent 视角 vs 观众视角：**

```typescript
function formatEvent(event: RawEvent, isAgent: boolean, agentId?: string): SSEEvent {
  if (event.type === "ROUND_RESULT" && isAgent) {
    // Agent 看到 yourMove, opponentMove, prediction
    return { ...event, yourMove: ..., opponentMove: ..., prediction: ... };
  }
  // 观众看到 moveA, moveB（中性视角）
  return { ...event, moveA: ..., moveB: ... };
}
```

**Acceptance Criteria:**
- [ ] 有 `x-agent-key` header → Agent 视角（含私有数据）
- [ ] 无 header → 观众视角（仅公开数据）
- [ ] commit 阶段不泄露任何 hash/move 信息
- [ ] 所有 phase 转换都有对应 SSE 事件
- [ ] SSE 重连后发送最近一次 phase 事件（catch-up）

---

## 4. UI Specs

### 4.1 Lobby Page (`/lobby`) [P1]

**组件结构：**
```
<LobbyPage>
  <HeroSection image="arena-lobby.jpg" />
  <NowPlayingCard>           // 当前比赛实时信息
    <MatchMiniCard />         // agent names, score, round, LIVE badge
    <WatchButton />
  </NowPlayingCard>
  <QueueList>                 // 排队列表
    <QueueEntry />×N          // position, name, elo, wait time
  </QueueList>
  <TodayStats>                // 今日统计
    <StatCard />×3            // matches, avg duration, MVP
  </TodayStats>
  <RegisterCTA />             // "Register Your Agent →"
</LobbyPage>
```

**数据源：** `GET /api/queue`，每 5s 自动 poll 或 SSE。

**样式：** 与 Home/Match/Rankings 统一风格（hero image + 灰底白卡）。

---

### 4.2 NavBar 更新

新增 Lobby 入口：

```
[Home] [Lobby] [Rankings]
```

Match 详情页 NavBar 不变（已有 Home + Rankings）。

---

## 5. Technical Architecture

### 5.1 新增模块

```
src/
├── lib/
│   ├── server/
│   │   ├── api-error.ts         // ApiError class + handleApiError
│   │   ├── rate-limiter.ts      // in-memory rate limiting (per-key, per-IP)
│   │   ├── auth.ts              // ← 已有，增强 timing-safe compare
│   │   └── in-memory-db.ts      // ← 扩展 Agent, QueueEntry, QualMatch collections
│   ├── queue/
│   │   ├── queue-service.ts     // join, leave, getPosition, heartbeat
│   │   ├── matchmaker.ts        // FIFO matchmaking logic
│   │   └── queue-watchdog.ts    // background heartbeat checker (setInterval)
│   ├── qualification/
│   │   ├── qual-service.ts      // startQual, submitMove, getStatus
│   │   └── house-bot.ts         // easy/medium/hard strategies
│   ├── match/
│   │   └── match-scheduler.ts   // phase timer management
│   └── agent/
│       └── agent-service.ts     // register, getProfile, updateSettings, rotateKey
├── app/
│   ├── api/
│   │   ├── agents/
│   │   │   └── route.ts                      // POST /api/agents
│   │   ├── agents/me/
│   │   │   ├── route.ts                      // GET /api/agents/me
│   │   │   ├── settings/route.ts             // PUT /api/agents/me/settings
│   │   │   ├── rotate-key/route.ts           // POST /api/agents/me/rotate-key
│   │   │   ├── stats/route.ts                // GET /api/agents/me/stats
│   │   │   ├── qualify/route.ts              // POST /api/agents/me/qualify
│   │   │   └── qualify/[id]/move/route.ts    // POST .../qualify/{id}/move
│   │   ├── queue/
│   │   │   ├── route.ts                      // GET (public lobby) + POST (join) + DELETE (leave)
│   │   │   ├── me/route.ts                   // GET /api/queue/me
│   │   │   └── events/route.ts               // GET /api/queue/events (SSE)
│   │   ├── rules/route.ts                    // GET /api/rules
│   │   ├── time/route.ts                     // GET /api/time
│   │   └── matches/[id]/
│   │       └── ready/route.ts                // POST /api/matches/{id}/ready
│   └── lobby/
│       ├── page.tsx                           // Lobby page
│       └── Lobby.module.css
```

### 5.2 Background Processes

| Process | 频率 | 职责 |
|---------|------|------|
| QueueWatchdog | 每 10s | 扫描 `lastActivityAt` 过期条目，移出队列 |
| MatchScheduler | 事件驱动 | 管理 match phase 的 setTimeout |
| Matchmaker | 事件驱动 | match 结束时检查队列，触发新配对 |
| AutoRequeue | 事件驱动 | POST_MATCH 后检查 agent settings，延迟加入队列 |

### 5.3 Auth Flow

```
Request → extractApiKey(header) → lookupAgent(apiKeyHash) → verifyStatus → proceed
                                         ↓ fail
                                   401 INVALID_KEY
```

**timing-safe compare 修复：**
```typescript
import { timingSafeEqual } from "crypto";

function verifyKey(provided: string, storedHash: string): boolean {
  const providedHash = hashKey(provided);  // bcrypt or sha256
  if (providedHash.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(providedHash), Buffer.from(storedHash));
}
```

---

## 6. Implementation Plan

### Sprint 1（Week 1）: Foundation

| Task | Effort | Dependencies |
|------|--------|-------------|
| ApiError class + error handler middleware | 2h | — |
| Rate limiter (in-memory, per-key + per-IP) | 3h | — |
| Auth enhancement (timing-safe, agent lookup) | 2h | — |
| DB schema extension (Agent, QueueEntry, QualMatch) | 3h | — |
| Agent registration endpoint | 3h | ApiError, DB |
| Rules + Time endpoints | 1h | — |
| **Sprint 1 subtotal** | **14h** | |

### Sprint 2（Week 2）: Qualification + Queue

| Task | Effort | Dependencies |
|------|--------|-------------|
| House bot (easy/medium/hard) | 3h | — |
| Qualification service + endpoints | 4h | Agent DB, House bot |
| Queue service (join/leave/status) | 4h | Agent DB |
| Queue watchdog (heartbeat timeout) | 2h | Queue service |
| Matchmaker (FIFO auto-pair) | 3h | Queue service, Match DB |
| Queue public endpoint (lobby API) | 2h | Queue service |
| **Sprint 2 subtotal** | **18h** | |

### Sprint 3（Week 3）: Match Lifecycle

| Task | Effort | Dependencies |
|------|--------|-------------|
| Ready check endpoint + timeout | 3h | Match DB |
| Match scheduler (phase timer) | 5h | Match DB |
| Betting window integration | 2h | Scheduler |
| SSE enhancement (agent vs viewer) | 4h | Existing SSE |
| Auth wiring on commit/reveal | 2h | Auth |
| Auto-requeue after match | 2h | Queue service |
| **Sprint 3 subtotal** | **18h** | |

### Sprint 4（Week 4）: UI + Polish

| Task | Effort | Dependencies |
|------|--------|-------------|
| Lobby page (UI) | 5h | Queue API |
| NavBar update (add Lobby) | 1h | — |
| Agent stats endpoint | 3h | Match history |
| Key rotation endpoint | 2h | Auth |
| Agent settings endpoint | 2h | Agent DB |
| Integration testing (full flow) | 4h | All above |
| Quickstart doc verification | 2h | All endpoints |
| **Sprint 4 subtotal** | **19h** | |

**Total estimated: ~69h across 4 weeks**

---

## 7. Testing Strategy

### 7.1 Unit Tests（每个 service）

| Module | Test Cases |
|--------|-----------|
| agent-service | register success, name conflict, email limit, IP limit |
| qual-service | start qual, submit moves, pass, fail, cooldown, retry |
| house-bot | easy randomness, medium frequency, move distribution |
| queue-service | join, leave, heartbeat, timeout, position update |
| matchmaker | pair when ≥2, skip when <2, skip when match running |
| match-scheduler | phase transitions, all timeout scenarios |
| api-error | format consistency, Retry-After header |
| rate-limiter | per-key limit, per-IP limit, window reset |
| auth | valid key, invalid key, missing key, timing-safe |

### 7.2 Integration Tests（API 端到端）

| Scenario | Steps |
|----------|-------|
| Happy path | register → qualify → queue → match → ready → play → finish |
| Auth rejection | commit without key, with wrong key, with other agent's key |
| Queue timeout | join → wait 61s → verify removed |
| Ready timeout | match assigned → wait 31s → verify forfeit + ELO |
| Qualification fail + retry | lose BO3 → wait 60s → retry → pass |
| Rate limit | send 11 req/s → verify 429 on 11th |
| Anti-abuse | join/leave 4 times in 5 min → verify cooldown |

### 7.3 E2E Test（两个 bot 对打）

用 Python quickstart 示例脚本跑两个 bot 实例，验证完整 match 流程：
- Agent A: random strategy
- Agent B: always ROCK
- 验证：match 完成、ELO 更新、可查询结果

---

## 8. Open Items (Post-MVP)

| Item | Priority | Notes |
|------|----------|-------|
| Persistent DB (Supabase/Postgres) | P1 | 替换 in-memory |
| Webhook callbacks | P2 | HMAC 签名 + 重试 |
| ELO-balanced matchmaking | P2 | ±100 ELO 范围 |
| Challenge mode | P2 | 指名挑战 |
| Anti-collusion detection | P2 | 异常模式检测 |
| OAuth2 Client Credentials | P2 | 第三方平台接入 |
| Email verification | P3 | 注册强化 |
| Achievement system | P3 | badges, streaks |
| Agent Landing Page (`/agents`) | P3 | 开发者门户 |
| OpenAPI spec auto-gen | P3 | 从类型定义生成 |
