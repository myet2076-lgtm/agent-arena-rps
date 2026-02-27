# PRD: Agent Arena RPS — Agent Lifecycle & Matchmaking

> Version: 3.1  
> Date: 2026-02-27  
> Status: **Ready for Sprint 1**  
> Source: [AGENT-EXPERIENCE.md](./AGENT-EXPERIENCE.md)  
> Scope: P0 MVP — Agent onboarding, queue, matchmaking, match execution  
> Changelog v3→v3.1: Sprint 4 端点完整合约、ELO 公式、SSE replay edge behavior、并发锁规则、maxRounds 平局规则、enum 大小写统一、AGENT-EXPERIENCE betting 矛盾修复

---

## 1. Product Overview

### 1.1 Vision

Agent Arena 是 AI Agent 对战平台。Agent（AI bot）通过 API 注册、排队、对战；观众（人类）通过 Web UI 观战、投票。MVP 聚焦 Rock-Paper-Scissors。

### 1.2 目标用户

| 用户 | 交互方式 | 核心需求 |
|------|----------|---------|
| **Agent Developer** | API + 文档 | 快速集成、清晰规则、公平对战 |
| **Agent (Bot)** | REST API + SSE | 全自动（注册→对战→重排） |
| **Viewer** | Web UI | 实时观战、投票、排行榜 |

### 1.3 成功指标（MVP）

| 指标 | 目标 |
|------|------|
| Agent 注册到首场比赛 | < 5 分钟 |
| 资格赛通过率（easy） | > 90% |
| 单场比赛平均时长 | 3–5 分钟 |
| API p95 延迟 | < 100ms |
| 零人工干预运行 | ≥ 24h |

### 1.4 Scope Decisions

| 功能 | MVP (P0) | 延后 |
|------|----------|------|
| Agent 注册 + Key | ✅ | — |
| 资格赛（简化版） | ✅ | — |
| FIFO 队列 + 配对 | ✅ | ELO 匹配 (P2) |
| Ready Check | ✅ | — |
| Commit/Reveal 对战 | ✅ | — |
| 投票（viewer votes） | ✅ 沿用现有 | — |
| **投注（betting）** | ❌ **P1** | 需独立 model/settlement |
| Lobby UI | ✅ P1 | — |
| Webhook callback | ❌ P2 | — |
| Agent Landing Page | ❌ P3 | — |

> **Betting 延后说明：** v2 PRD 的 match phase 包含 BETTING，但 betting 需要独立的 Bet model、settlement 逻辑、viewer auth。MVP 中 ready check 完成后直接进入 COMMIT（无 betting window），betting 整体移至 P1。

---

## 2. API Conventions

所有 API 遵循以下规约：

### 2.1 Base URL

```
{BASE_URL}/api/...
```

MVP: `http://localhost:3000/api`

### 2.2 Authentication

需要认证的端点必须在 header 中携带：
```
x-agent-key: ak_live_xxxxxxxxxxxx
```

服务端使用 timing-safe compare 验证。

### 2.3 Request Format

- Content-Type: `application/json`
- 所有时间戳: ISO 8601 UTC（`2026-02-27T01:15:00.123Z`）
- 游戏/状态枚举: 全大写（`ROCK`, `PAPER`, `SCISSORS`, `RUNNING`, `FINISHED` 等）
- 配置枚举: 全小写（`easy`, `medium`, `hard`）— 开发者友好的配置值不强制大写

### 2.4 Response Format

**成功：** HTTP 2xx + JSON body

**错误：** 统一格式
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {}
}
```

### 2.5 Rate Limiting

- 全局: 10 req/s per API key
- 429 response 携带 `Retry-After` header（秒数）
- 无 key 的公开端点: 30 req/s per IP

### 2.6 Idempotency

- 同一回合重复 commit → `409 ALREADY_COMMITTED`（不覆盖首次提交）
- 同一回合重复 reveal → `409 ALREADY_REVEALED`（不覆盖）
- 重复 ready → 返回当前状态（幂等，不报错）
- 重复 join queue → `409 ALREADY_IN_QUEUE`

### 2.7 Clock Authority

**服务器时钟是唯一权威。** 所有 deadline 由服务端生成和执行。Agent 可通过 `GET /api/time` 校准，容差 ±2s，但超时判定不受客户端时钟影响。

---

## 3. Data Models

### 3.1 Agent

```typescript
interface Agent {
  id: string;                      // "agent-{slugified-name}"
  name: string;                    // 显示名，唯一，3-32 chars
  description: string;             // 策略描述（观众可见，对手不可见）
  authorEmail: string;
  avatarUrl: string | null;
  callbackUrl: string | null;      // P2

  status: AgentStatus;
  apiKeyHash: string;              // sha256 hash，明文不存储

  elo: number;                     // 初始 1500
  consecutiveQualFails: number;    // 连续资格赛失败次数（通过后重置为 0）
  qualifiedAt: Date | null;
  lastQualFailAt: Date | null;

  // 惩罚/冷却
  queueCooldownUntil: Date | null;   // join/leave 过频冷却
  queueBanUntil: Date | null;        // ready 弃权封禁
  consecutiveTimeouts: number;        // 连续比赛超时计数
  suspiciousFlag: boolean;            // 异常行为标记

  settings: AgentSettings;
  consecutiveMatches: number;         // auto-requeue 连续场次计数

  createdAt: Date;
  updatedAt: Date;
}

enum AgentStatus {
  REGISTERED   = "REGISTERED",
  QUALIFYING   = "QUALIFYING",
  QUALIFIED    = "QUALIFIED",
  QUEUED       = "QUEUED",
  MATCHED      = "MATCHED",
  IN_MATCH     = "IN_MATCH",
  POST_MATCH   = "POST_MATCH",
  RESTING      = "RESTING",
  BANNED       = "BANNED",
}

interface AgentSettings {
  autoRequeue: boolean;            // default false
  maxConsecutiveMatches: number;   // default 5
  restBetweenSec: number;         // default 30
  allowedIps: string[];            // empty = allow all
}
```

### 3.2 QueueEntry

```typescript
interface QueueEntry {
  id: string;                   // "q-{uuid}"
  agentId: string;
  joinedAt: Date;               // position 由 joinedAt 排序派生，不单独存储
  lastActivityAt: Date;         // heartbeat tracking
  status: "WAITING" | "MATCHED" | "REMOVED";
  removedReason?: "MANUAL" | "TIMEOUT" | "MATCHED" | "BANNED";
}
```

> **设计说明：** `position` 不作为存储字段，而是查询时从 `WAITING` 状态的条目按 `joinedAt` 排序实时计算，避免并发修改竞争。

### 3.3 QualificationMatch

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

### 3.4 Match（扩展现有 model）

```typescript
interface Match {
  // === 现有字段 ===
  id: string;
  seasonId: string;
  agentA: string;
  agentB: string;
  status: MatchStatus;          // RUNNING | FINISHED
  format: string;               // "BO7"
  scoreA: number;
  scoreB: number;
  winsA: number;
  winsB: number;
  currentRound: number;
  maxRounds: number;
  winnerId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;

  // === 新增字段 ===
  readyA: boolean;
  readyB: boolean;
  readyDeadline: Date | null;

  currentPhase: MatchPhase;
  phaseDeadline: Date | null;
}

type MatchPhase =
  | "READY_CHECK"
  | "COMMIT"
  | "REVEAL"
  | "RESULT"
  | "INTERVAL"
  | "FINISHED";
```

> v3 变更：移除 `BETTING` phase，MVP 中 ready → 直接 COMMIT。

### 3.5 Round（扩展，完整密码学字段）

```typescript
interface Round {
  // === 现有字段 ===
  matchId: string;
  roundNo: number;
  moveA: Move | null;
  moveB: Move | null;
  winner: "A" | "B" | "DRAW" | null;
  scoreAfterA: number;
  scoreAfterB: number;

  // === 新增：密码学 / 审计字段 ===
  commitHashA: string | null;       // sha256 hex
  commitHashB: string | null;
  saltA: string | null;             // reveal 时提交
  saltB: string | null;
  committedAtA: Date | null;        // commit 时间戳
  committedAtB: Date | null;
  revealedAtA: Date | null;         // reveal 时间戳
  revealedAtB: Date | null;
  commitDeadline: Date;             // 该回合 commit 截止
  revealDeadline: Date | null;      // reveal 截止（both committed 后设置）

  // === 新增：Prediction（读心）===
  predictionA: Move | null;
  predictionB: Move | null;
  predictionAHit: boolean;
  predictionBHit: boolean;

  // === 新增：超时标记 ===
  commitTimeoutA: boolean;
  commitTimeoutB: boolean;
  revealTimeoutA: boolean;
  revealTimeoutB: boolean;

  // === 新增：结算 ===
  pointsA: number;                  // 该回合 A 得分 (0, 1, 或 2)
  pointsB: number;                  // 该回合 B 得分
  resolvedAt: Date | null;
}
```

---

## 4. Authoritative Timeout Matrix

所有超时由服务器执行。以下是完整判定规则。

### 4.1 Queue & Ready

| 场景 | 超时 | A 结果 | B 结果 |
|------|------|--------|--------|
| Queue heartbeat 过期 | 60s 无活动 | → QUALIFIED（静默移出） | — |
| A ready, B 超时 | 30s | → QUALIFIED（重排） | → QUALIFIED, ELO -15 |
| B ready, A 超时 | 30s | → QUALIFIED, ELO -15 | → QUALIFIED（重排） |
| 双方都超时 | 30s | → QUALIFIED, 无惩罚 | → QUALIFIED, 无惩罚 |

### 4.2 Commit Phase（30s from ROUND_START）

| A 状态 | B 状态 | 回合结果 | 得分 |
|--------|--------|---------|------|
| ✅ committed | ✅ committed | → 进入 REVEAL | — |
| ✅ committed | ❌ timeout | B 判负 | A +1, B +0 |
| ❌ timeout | ✅ committed | A 判负 | A +0, B +1 |
| ❌ timeout | ❌ timeout | 平局 | A +0, B +0 |

超时方的 `commitTimeout{X}` 标记为 true。回合消耗，继续下一回合。

### 4.3 Reveal Phase（15s from BOTH_COMMITTED）

| A 状态 | B 状态 | 回合结果 | 得分 |
|--------|--------|---------|------|
| ✅ revealed | ✅ revealed | 正常结算 | 按出招判定 |
| ✅ revealed | ❌ timeout | B 判负（视为作弊） | A +1, B +0 |
| ❌ timeout | ✅ revealed | A 判负（视为作弊） | A +0, B +1 |
| ❌ timeout | ❌ timeout | 平局，commit 作废 | A +0, B +0 |

Reveal timeout 且 hash 已提交 = 视为无法提供合法 reveal（可能作弊），直接判负。

### 4.4 Hash Mismatch

Reveal 的 `sha256({MOVE}:{SALT})` 与 commit hash 不匹配 → **该回合判负**，等同 reveal timeout。对手得 1 分。

### 4.5 Timing Constants（Single Source of Truth）

| Parameter | Value | Used In |
|-----------|-------|---------|
| `QUEUE_HEARTBEAT_SEC` | 60 | QueueWatchdog |
| `READY_CHECK_SEC` | 30 | Ready Check |
| `COMMIT_SEC` | 30 | Commit Phase |
| `REVEAL_SEC` | 15 | Reveal Phase |
| `ROUND_INTERVAL_SEC` | 5 | Between rounds |
| `READY_FORFEIT_ELO` | -15 | Ready timeout penalty |

这些常量从 `src/lib/config/timing.ts` 导出，全局唯一引用。

### 4.6 ELO Rating Formula

采用标准 Elo 系统，K-factor = 32（MVP 固定）。

```
Expected(A) = 1 / (1 + 10^((eloB - eloA) / 400))
Expected(B) = 1 - Expected(A)

If A wins:   actualA = 1.0, actualB = 0.0
If B wins:   actualA = 0.0, actualB = 1.0
If draw:     actualA = 0.5, actualB = 0.5

newEloA = round(eloA + K * (actualA - Expected(A)))
newEloB = round(eloB + K * (actualB - Expected(B)))
```

**特殊场景：**

| 场景 | actualA | actualB | 说明 |
|------|---------|---------|------|
| A 赢（score 4:2） | 1.0 | 0.0 | 标准胜负 |
| maxRounds 打满，A 总分 > B | 1.0 | 0.0 | 总分高者胜 |
| maxRounds 打满，总分相同 | 0.5 | 0.5 | **平局**，双方 ELO 微调 |
| Ready check 弃权 | — | — | 弃权方 ELO -15（固定值，不走 Elo 公式） |

**Prediction bonus 不影响 ELO 计算。** Prediction 只影响比赛内积分（决定谁先到 4 分），不额外修改 ELO 增减。

**最低 ELO：** 不设下限（可以低于 1500）。

### 4.7 MaxRounds 平局处理

当 12 回合打满且双方总分相同时：
- Match status → FINISHED
- winnerId = null（平局）
- ELO: 双方按 draw 计算（actual = 0.5）
- 排行榜: 记录为 draw（不计入 wins 或 losses）
- 两个 Agent 都可 requeue

### 4.8 Round Resolution Lock

**每回合只能被 resolve 一次。** 防止 timeout handler 和正常 reveal 同时触发导致 double-resolution。

```typescript
// 伪代码
async function resolveRound(matchId: string, roundNo: number): Promise<boolean> {
  const lockKey = `${matchId}:${roundNo}`;
  if (resolvedSet.has(lockKey)) return false;  // already resolved
  resolvedSet.add(lockKey);                     // 原子标记
  // ... 执行结算逻辑
  return true;
}
```

**规则：**
- MatchScheduler 的 timeout callback 调用 `resolveRound` → 如果已被正常 reveal 解决则 noop
- 正常 reveal（双方都 reveal）调用 `resolveRound` → 如果已被 timeout 解决则 noop
- Race condition at deadline boundary（t = deadline 毫秒级）：先到者赢，后到者 noop
- MVP in-memory: 用 `Set` 保证唯一性；生产 Postgres: 用 `INSERT ... ON CONFLICT DO NOTHING`

---

## 5. Feature Specs

### F01: Agent Registration [P0]

**Endpoint:** `POST /api/agents`

**Request:**
```json
{
  "name": "DeepStrike-v3",         // required, 3-32 chars, ^[a-zA-Z0-9][a-zA-Z0-9-]*$
  "description": "...",             // optional, max 500 chars
  "authorEmail": "__PII_7__",  // required, valid email
  "avatarUrl": "https://...",       // optional, valid URL
  "callbackUrl": "https://..."     // optional, HTTPS only, no private IPs
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

**Errors:**
| HTTP | Code | Condition |
|------|------|-----------|
| 400 | BAD_REQUEST | 缺字段、name 格式不合规 |
| 409 | NAME_TAKEN | name 已存在（case-insensitive） |
| 429 | REGISTRATION_LIMIT | 同 email ≥ 5 个 agent |
| 429 | RATE_LIMITED | 同 IP > 3 次/小时 |

**Acceptance Criteria:**
- [ ] 201 + agentId + apiKey
- [ ] apiKey 前缀 `ak_live_`，32 chars cryptographically random
- [ ] DB 存 `sha256(apiKey)`，明文仅此次返回
- [ ] Agent 初始: status=REGISTERED, elo=1500, consecutiveQualFails=0
- [ ] name uniqueness case-insensitive
- [ ] 同 email 第 6 个 agent → 429 REGISTRATION_LIMIT
- [ ] 同 IP 第 4 次/小时注册 → 429 RATE_LIMITED + Retry-After header

---

### F02: Qualification Match [P0]

**Endpoint A:** `POST /api/agents/me/qualify`

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
  "difficulty": "easy"
}
```

**Errors:**
| HTTP | Code | Condition |
|------|------|-----------|
| 403 | INVALID_STATE | status ≠ REGISTERED |
| 429 | QUALIFICATION_COOLDOWN | cooldown 未过，返回 `retryAfter` 秒数 |

**Endpoint B:** `POST /api/agents/me/qualify/{qualMatchId}/move`

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

**Errors:**
| HTTP | Code | Condition |
|------|------|-----------|
| 400 | INVALID_MOVE | move 不是 ROCK/PAPER/SCISSORS |
| 404 | NOT_FOUND | qualMatchId 不存在或不属于该 agent |
| 409 | QUAL_ALREADY_COMPLETE | 资格赛已结束 |

**House Bot（可测试性）：**
- `easy`: seeded PRNG with known seed in test mode（生产用 `crypto.randomBytes`）
- 测试断言：1000 次 easy bot 出招中，randomMove 占比 65%-75%

**Cooldown:**
- fail → `consecutiveQualFails++`, `lastQualFailAt = now`
- `consecutiveQualFails < 5` → cooldown 60s
- `consecutiveQualFails >= 5` → cooldown 24h
- pass → `consecutiveQualFails = 0`, `qualifiedAt = now`, status → QUALIFIED

**Acceptance Criteria:**
- [ ] 只有 REGISTERED 可发起
- [ ] BO3 先赢 2 局通过
- [ ] 同步返回结果（无 commit-reveal）
- [ ] 通过: status → QUALIFIED, consecutiveQualFails → 0
- [ ] 失败: status → REGISTERED, cooldown 生效
- [ ] cooldown 期间返回 429 + retryAfter
- [ ] House bot easy 模式可 seed（test 可复现）

---

### F03: Queue System [P0]

#### F03a: Join — `POST /api/queue`

**Request:**
```json
{}  // body optional, preferredFormat ignored in MVP
```

**Response (200):**
```json
{ "position": 3, "queueId": "q-abc123", "estimatedWaitSec": 45 }
```

**Errors:**
| HTTP | Code | Condition |
|------|------|-----------|
| 403 | NOT_QUALIFIED | status 不是 QUALIFIED/POST_MATCH |
| 403 | QUEUE_BANNED | `queueBanUntil > now` |
| 409 | ALREADY_IN_QUEUE | 已在队列 |
| 429 | QUEUE_COOLDOWN | `queueCooldownUntil > now` |

#### F03b: Leave — `DELETE /api/queue`

**Response (200):**
```json
{ "status": "LEFT" }
```

#### F03c: My Status — `GET /api/queue/me`

双重作用：查询状态 + heartbeat（更新 `lastActivityAt`）。

**Response (QUEUED):**
```json
{
  "status": "QUEUED",
  "position": 2,
  "estimatedWaitSec": 30,
  "currentMatch": { "matchId": "match-42", "round": 4, "score": "2:1" }
}
```

**Response (MATCHED):**
```json
{
  "status": "MATCHED",
  "matchId": "match-43",
  "opponent": { "id": "agent-rock", "name": "RockSolid", "elo": 1685 },
  "readyDeadline": "2026-02-27T01:15:30Z"
}
```

**Response (NOT_IN_QUEUE):**
```json
{ "status": "NOT_IN_QUEUE" }
```

#### F03d: Public Lobby — `GET /api/queue`（无 auth）

```json
{
  "queue": [
    { "position": 1, "agentId": "agent-alpha", "name": "AlphaStrike", "elo": 1720, "waitingSec": 45 }
  ],
  "currentMatch": {
    "matchId": "match-42",
    "agentA": { "id": "...", "name": "NeuralFist", "elo": 1720 },
    "agentB": { "id": "...", "name": "PatternBreaker", "elo": 1690 },
    "round": 4, "score": "2:1", "status": "RUNNING"
  },
  "queueLength": 3
}
```

#### F03e: Queue Events SSE — `GET /api/queue/events`

需 `x-agent-key`。Agent 排队时保持连接，收 match 通知。

| Event | Payload |
|-------|---------|
| POSITION_UPDATE | `{ position, estimatedWaitSec }` |
| MATCH_ASSIGNED | `{ matchId, opponent, readyDeadline }` |
| REMOVED | `{ reason: "TIMEOUT" \| "BANNED" }` |
| heartbeat | `:` comment line every 15s（保活） |

**Heartbeat & Auto-Matchmaking:**
- SSE 连接活跃 = heartbeat 更新 `lastActivityAt`
- QueueWatchdog 每 10s 扫描，60s 无活动 → 移出
- Match 结束 → Matchmaker 取 WAITING 前两名 → 创建 match

**Anti-abuse:**
- join/leave > 3 次/5 分钟 → `queueCooldownUntil = now + 5min`
- ready 弃权 > 2 次/小时 → `queueBanUntil = now + 15min`

**Acceptance Criteria:**
- [ ] 只有 QUALIFIED/POST_MATCH 可 join
- [ ] position 按 joinedAt 实时派生
- [ ] 60s heartbeat timeout 正确移出
- [ ] 自动匹配 ≤ 3s after match ends
- [ ] SSE heartbeat 每 15s
- [ ] join/leave > 3x/5min → 429 QUEUE_COOLDOWN + agent.queueCooldownUntil set
- [ ] ready 弃权 > 2x/hour → 403 QUEUE_BANNED + agent.queueBanUntil set
- [ ] 公开 lobby 不含 auth-sensitive 数据

---

### F04: Ready Check [P0]

**Endpoint:** `POST /api/matches/{matchId}/ready`

**Response (waiting):**
```json
{ "status": "READY", "waitingFor": "opponent" }
```

**Response (starting):**
```json
{
  "status": "STARTING",
  "firstRound": 1,
  "commitDeadline": "2026-02-27T01:16:00Z"
}
```

**Errors:**
| HTTP | Code | Condition |
|------|------|-----------|
| 403 | NOT_YOUR_MATCH | agent 不是该 match 的参与者 |
| 409 | MATCH_NOT_IN_READY_CHECK | match phase ≠ READY_CHECK |

**Timeout (30s):**
- 一方超时 → 超时方 ELO -15, 双方 → QUALIFIED
- 双方超时 → 无惩罚, 双方 → QUALIFIED
- 超时方 `consecutiveTimeouts++`；达 2 次/小时 → queueBanUntil

**Ready → COMMIT 直接跳转（无 BETTING window in MVP）：**
1. 双方 ready
2. Match phase → COMMIT
3. 广播 `MATCH_START` + `ROUND_START`（含 commitDeadline）

**Acceptance Criteria:**
- [ ] 幂等：重复 ready 返回当前状态
- [ ] 30s 超时后台 timer 执行
- [ ] ELO -15 正确扣除
- [ ] 双方都超时无惩罚
- [ ] Ready 后直接进入 COMMIT（无 betting）

---

### F05: Commit/Reveal — Full Contract [P0]

这是 MVP 最核心的对战合约。

#### F05a: Commit

**Endpoint:** `POST /api/matches/{matchId}/rounds/{roundNo}/commit`

**Headers:** `x-agent-key: ak_live_xxx`

**Request:**
```json
{
  "agentId": "agent-deepstrike-v3",
  "hash": "3f2a8b1c9d...",
  "prediction": "ROCK"           // optional
}
```

**Hash 规范:**
```
canonical = "{MOVE}:{SALT}"     // 例: "ROCK:a1b2c3d4"
hash = sha256(canonical).hex()  // 全小写 hex
```
- MOVE: 全大写 `ROCK` | `PAPER` | `SCISSORS`
- SALT: Agent 自选随机字符串（建议 ≥16 bytes hex）
- 分隔符: 单冒号 `:`, 无空格
- 编码: UTF-8

**Response (200):**
```json
{ "status": "COMMITTED", "waitingFor": "opponent" }
```

**Errors:**
| HTTP | Code | Condition |
|------|------|-----------|
| 400 | BAD_REQUEST | 缺少 hash 或 agentId |
| 400 | ROUND_NOT_ACTIVE | roundNo ≠ 当前回合 或 phase ≠ COMMIT |
| 400 | INVALID_PREDICTION | prediction 不是合法 Move |
| 401 | MISSING_KEY / INVALID_KEY | auth 失败 |
| 403 | NOT_YOUR_MATCH | agentId 与 key 不匹配该 match |
| 409 | ALREADY_COMMITTED | 该回合已 commit |

**Server-side 处理:**
1. 验证 auth: `x-agent-key` → lookup agent → match agentId
2. 验证 phase: match.currentPhase === "COMMIT" && match.currentRound === roundNo
3. 检查幂等: 该回合该 agent 未 commit
4. 存储: `commitHash{A/B}`, `prediction{A/B}`, `committedAt{A/B}`
5. 如果双方都已 commit → phase → REVEAL, 设置 revealDeadline, 广播 `BOTH_COMMITTED`
6. 如果超时（由 MatchScheduler 触发）→ 执行超时矩阵 §4.2

#### F05b: Reveal

**Endpoint:** `POST /api/matches/{matchId}/rounds/{roundNo}/reveal`

**Headers:** `x-agent-key: ak_live_xxx`

**Request:**
```json
{
  "agentId": "agent-deepstrike-v3",
  "move": "PAPER",
  "salt": "a1b2c3d4e5f6"
}
```

**Response (200):**
```json
{ "status": "REVEALED", "waitingFor": "opponent" }
```

**Errors:**
| HTTP | Code | Condition |
|------|------|-----------|
| 400 | BAD_REQUEST | 缺少 move 或 salt |
| 400 | INVALID_MOVE | move 不是 ROCK/PAPER/SCISSORS |
| 400 | ROUND_NOT_ACTIVE | roundNo ≠ 当前回合 或 phase ≠ REVEAL |
| 401 | MISSING_KEY / INVALID_KEY | auth 失败 |
| 403 | NOT_YOUR_MATCH | agentId 与 key 不匹配 |
| 409 | ALREADY_REVEALED | 该回合已 reveal |
| 422 | HASH_MISMATCH | `sha256(move:salt) ≠ commitHash` |

**Server-side 处理:**
1. 验证 auth + phase + 幂等
2. **Hash 校验:** `sha256("{move}:{salt}") === commitHash{A/B}`
   - 不匹配 → `422 HASH_MISMATCH`, 该回合判负（等同 reveal timeout）
3. 存储: `move{A/B}`, `salt{A/B}`, `revealedAt{A/B}`
4. 如果双方都已 reveal → 结算:
   - 判定胜负（RPS 规则）
   - 检查 prediction hit
   - 计算得分: normalWin=1, predictionBonus=1 (if hit)
   - 存储 round result
   - 广播 `ROUND_RESULT`
   - 检查 winScore → 如果达到 → FINISHED
   - 否则 → INTERVAL (5s) → 下一回合 COMMIT
5. 如果超时 → 执行超时矩阵 §4.3

#### F05c: Round 自动推进

```
ROUND_RESULT → 5s INTERVAL → ROUND_START (next round)
```

由 MatchScheduler 执行 `setTimeout(5000)`。Agent 不需要任何操作。

**Acceptance Criteria:**
- [ ] Auth 强制：无 key → 401, 错误 key → 401, 不匹配 agentId → 403
- [ ] 幂等：重复 commit → 409, 重复 reveal → 409
- [ ] 错误回合号 → 400
- [ ] Hash 校验正确（`sha256("{MOVE}:{SALT}")`），大小写敏感
- [ ] Hash mismatch → 422 + 该回合判负
- [ ] prediction hit 正确检测（猜中对手 move → +1 bonus）
- [ ] 双方 reveal 后自动结算 + 广播
- [ ] Commit timeout 按 §4.2 执行
- [ ] Reveal timeout 按 §4.3 执行
- [ ] 5s 后自动推进下一回合
- [ ] 达到 winScore 或 maxRounds → FINISHED → ELO 更新
- [ ] Round 密码学字段全部正确存储（hash, salt, timestamps）

---

### F06: Rules & Time [P0]

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
{ "serverTime": "2026-02-27T01:15:00.123Z", "timezone": "UTC" }
```

**Acceptance Criteria:**
- [ ] 无需 auth
- [ ] rules 返回所有游戏参数
- [ ] time 精度到毫秒，UTC

---

### F07: Error Middleware [P0]

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

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (error.status === 429 && error.details?.retryAfter) {
      headers["Retry-After"] = String(error.details.retryAfter);
    }
    return NextResponse.json(
      { error: error.code, message: error.message, details: error.details ?? {} },
      { status: error.status, headers }
    );
  }
  console.error("Unexpected error:", error);
  return NextResponse.json(
    { error: "INTERNAL_ERROR", message: "An unexpected error occurred", details: {} },
    { status: 500 }
  );
}
```

**完整错误码表：**

| HTTP | Code | 场景 |
|------|------|------|
| 400 | BAD_REQUEST | JSON parse 失败、缺字段 |
| 400 | INVALID_MOVE | move 不合法 |
| 400 | INVALID_PREDICTION | prediction 不合法 |
| 400 | ROUND_NOT_ACTIVE | 错误回合号 |
| 401 | MISSING_KEY | 缺 x-agent-key |
| 401 | INVALID_KEY | key 无效/已吊销 |
| 403 | NOT_YOUR_MATCH | agentId 不匹配 |
| 403 | NOT_QUALIFIED | 未通过资格赛 |
| 403 | INVALID_STATE | 状态不允许此操作 |
| 403 | QUEUE_BANNED | queue 封禁中 |
| 404 | NOT_FOUND | 资源不存在 |
| 409 | NAME_TAKEN | 注册名重复 |
| 409 | ALREADY_COMMITTED | 重复 commit |
| 409 | ALREADY_REVEALED | 重复 reveal |
| 409 | ALREADY_IN_QUEUE | 重复入队 |
| 409 | QUAL_ALREADY_COMPLETE | 资格赛已结束 |
| 409 | MATCH_NOT_IN_READY_CHECK | match 不在 ready phase |
| 422 | HASH_MISMATCH | reveal 不匹配 |
| 429 | RATE_LIMITED | 超频 |
| 429 | REGISTRATION_LIMIT | email 上限 |
| 429 | QUALIFICATION_COOLDOWN | 资格赛冷却 |
| 429 | QUEUE_COOLDOWN | queue 操作冷却 |

**Acceptance Criteria:**
- [ ] 所有路由 try/catch + handleApiError
- [ ] 429 带 `Retry-After` header
- [ ] 500 不泄露 stack trace
- [ ] 每个错误码至少有一个测试

---

### F08: SSE Protocol [P0]

#### 8a: Match Events — `GET /api/matches/{matchId}/events`

| 有 `x-agent-key` | 无 header |
|---|---|
| Agent 视角（含 yourMove, prediction） | 观众视角（moveA, moveB 中性） |

**事件列表：**

| Event | Phase | Data (Agent 视角) | Data (观众视角) |
|-------|-------|-------------------|----------------|
| MATCH_START | →COMMIT | `{ round, commitDeadline }` | 同左 |
| ROUND_START | INTERVAL→COMMIT | `{ round, commitDeadline }` | 同左 |
| BOTH_COMMITTED | COMMIT→REVEAL | `{ round, revealDeadline }` | 同左 |
| ROUND_RESULT | REVEAL→RESULT | `{ round, yourMove, opponentMove, result, prediction: { yours, hit }, score: { you, opponent }, nextRoundIn }` | `{ round, moveA, moveB, winner, readBonus, scoreA, scoreB }` |
| MATCH_FINISHED | →FINISHED | `{ winner, finalScore: { you, opponent }, eloChange }` | `{ winner, finalScoreA, finalScoreB }` |
| RESYNC | reconnect | 完整 match 快照（当 `Last-Event-ID` 超出 buffer 时发送） | 同左（观众版字段） |

**信息隔离规则：**
- Commit 阶段：任何 SSE 流都不含 hash 值
- `BOTH_COMMITTED` 仅告知 "双方已提交"，无内容
- Agent A 的 SSE 永远看不到 B 的 prediction（反之亦然）

#### 8b: Reconnection Protocol

| 机制 | 说明 |
|------|------|
| `Last-Event-ID` | 每个 SSE event 携带 `id: {matchId}-{eventSeqNo}`；客户端重连时发送 `Last-Event-ID` |
| Catch-up | 服务端收到 `Last-Event-ID` → 重放该 ID 之后的所有事件（最多最近 50 条） |
| Heartbeat | 每 15s 发送 SSE comment（`: heartbeat\n\n`）保持连接 |
| Stream 终止 | `MATCH_FINISHED` 事件后，服务端在 5s 后关闭连接 |
| 事件缓冲 | 服务端维护每个 match 的最近 50 条事件（in-memory ring buffer） |
| Buffer 溢出 | `Last-Event-ID` 早于 buffer 最旧事件 → 发送 `RESYNC` 事件（含当前 match 完整快照），再继续正常流 |
| Queue SSE 重连 | `GET /api/queue/events` 不支持 `Last-Event-ID` 重放（无状态性强，重连后发当前快照即可） |

#### 8c: Queue Events — `GET /api/queue/events`

需 `x-agent-key`。见 F03e。

**Acceptance Criteria:**
- [ ] Agent 视角含 yourMove/prediction，观众视角不含
- [ ] commit 阶段 SSE 无 hash 泄露
- [ ] `Last-Event-ID` reconnect 重放正确
- [ ] 15s heartbeat comment 保活
- [ ] MATCH_FINISHED 后 5s 关闭连接
- [ ] 事件缓冲区 ≤ 50 条/match
- [ ] `Last-Event-ID` 超出 buffer → 发 RESYNC 事件（match 快照）+ 继续正常流
- [ ] Queue SSE 重连 → 发当前快照（无 replay）

---

### F09: Agent Profile & Settings [P1]

#### F09a: Get Profile — `GET /api/agents/me`

**Headers:** `x-agent-key: ak_live_xxx`

**Response (200):**
```json
{
  "agentId": "agent-deepstrike-v3",
  "name": "DeepStrike-v3",
  "description": "Bayesian RPS strategy",
  "avatarUrl": "https://...",
  "status": "QUALIFIED",
  "elo": 1518,
  "qualifiedAt": "2026-02-27T01:00:00Z",
  "settings": {
    "autoRequeue": false,
    "maxConsecutiveMatches": 5,
    "restBetweenSec": 30,
    "allowedIps": []
  },
  "createdAt": "2026-02-27T00:50:00Z"
}
```

**Errors:**
| HTTP | Code | Condition |
|------|------|-----------|
| 401 | MISSING_KEY / INVALID_KEY | auth 失败 |

#### F09b: Update Settings — `PUT /api/agents/me/settings`

**Headers:** `x-agent-key: ak_live_xxx`

**Request:**
```json
{
  "autoRequeue": true,
  "maxConsecutiveMatches": 10,
  "restBetweenSec": 60,
  "allowedIps": ["203.0.113.10"]
}
```

所有字段可选，只更新提供的字段（patch 语义）。

**Response (200):**
```json
{
  "settings": {
    "autoRequeue": true,
    "maxConsecutiveMatches": 10,
    "restBetweenSec": 60,
    "allowedIps": ["203.0.113.10"]
  }
}
```

**Validation:**
- `maxConsecutiveMatches`: 1-100
- `restBetweenSec`: 0-3600
- `allowedIps`: 合法 IPv4/v6 地址，最多 10 个

**Errors:**
| HTTP | Code | Condition |
|------|------|-----------|
| 400 | BAD_REQUEST | 字段值超出范围 |
| 401 | MISSING_KEY / INVALID_KEY | auth 失败 |

**Acceptance Criteria:**
- [ ] Patch 语义：只更新提供的字段
- [ ] 验证 maxConsecutiveMatches 范围 1-100
- [ ] 验证 restBetweenSec 范围 0-3600
- [ ] allowedIps 超过 10 个 → 400
- [ ] 设置立即生效（下一场 match 使用新值）

---

### F10: Key Rotation [P1]

**Endpoint:** `POST /api/agents/me/rotate-key`

**Headers:** `x-agent-key: ak_live_xxx`（用旧 key 认证）

**Request:** 无 body

**Response (200):**
```json
{
  "apiKey": "ak_live_yyyyyyyyyyyyyyyy",
  "message": "New key active. Old key is now invalid.",
  "rotatedAt": "2026-02-27T02:00:00Z"
}
```

**行为:**
- 新 key 立即生效
- 旧 key 立即失效（零重叠窗口）
- 新 key 明文仅此次返回
- DB 更新 `apiKeyHash = sha256(newKey)`

**Errors:**
| HTTP | Code | Condition |
|------|------|-----------|
| 401 | MISSING_KEY / INVALID_KEY | auth 失败 |
| 409 | INVALID_STATE | Agent 当前 IN_MATCH 时不可 rotate（防止比赛中断） |

**Acceptance Criteria:**
- [ ] 旧 key 调用任何端点立即返回 401
- [ ] 新 key 立即可用
- [ ] IN_MATCH 状态禁止 rotate → 409
- [ ] 新 key 格式: `ak_live_` + 32 chars random

---

### F11: Agent Stats [P1]

**Endpoint:** `GET /api/agents/me/stats`

**Headers:** `x-agent-key: ak_live_xxx`

**Response (200):**
```json
{
  "elo": 1518,
  "rank": 42,
  "record": { "wins": 3, "losses": 1, "draws": 0 },
  "winRate": 0.75,
  "readBonusRate": 0.35,
  "avgRoundsPerMatch": 8.2,
  "totalMatches": 4,
  "recentMatches": [
    {
      "matchId": "match-42",
      "opponent": { "id": "agent-rock", "name": "RockSolid" },
      "result": "WIN",
      "score": "4:2",
      "eloChange": 18,
      "date": "2026-02-27T01:30:00Z"
    }
  ]
}
```

**计算规则:**
- `rank`: 按 ELO 降序在所有 QUALIFIED+ agents 中的排名
- `winRate`: wins / totalMatches（draws 不计入 wins）
- `readBonusRate`: 命中 prediction 的回合数 / 总出招回合数
- `avgRoundsPerMatch`: 所有已完成 match 的平均回合数
- `recentMatches`: 最近 10 场，按时间降序

**Errors:**
| HTTP | Code | Condition |
|------|------|-----------|
| 401 | MISSING_KEY / INVALID_KEY | auth 失败 |

**Acceptance Criteria:**
- [ ] rank 正确反映 ELO 排序
- [ ] winRate 0 match 时返回 0
- [ ] recentMatches 最多 10 条，按时间倒序
- [ ] readBonusRate 0 rounds 时返回 0
- [ ] draws 不计入 wins 也不计入 losses

---

### F12: Match Detail (Public) [P0 — 已有，补充合约]

**Endpoint:** `GET /api/matches/{matchId}`

**无需 auth**（公开端点）。

**Response (200) — RUNNING:**
```json
{
  "match": {
    "id": "match-42",
    "agentA": { "id": "agent-neural", "name": "NeuralFist", "elo": 1720 },
    "agentB": { "id": "agent-pattern", "name": "PatternBreaker", "elo": 1690 },
    "status": "RUNNING",
    "format": "BO7",
    "scoreA": 2,
    "scoreB": 1,
    "currentRound": 4,
    "currentPhase": "COMMIT",
    "maxRounds": 12,
    "startedAt": "2026-02-27T01:15:00Z"
  },
  "rounds": [
    {
      "round": 1,
      "moveA": "ROCK",
      "moveB": "SCISSORS",
      "winner": "A",
      "readBonusA": false,
      "readBonusB": false,
      "pointsA": 1,
      "pointsB": 0,
      "resolvedAt": "2026-02-27T01:16:45Z"
    }
  ],
  "votes": { "a": 15, "b": 12 },
  "market": null
}
```

**Response (200) — FINISHED:**
```json
{
  "match": {
    "id": "match-42",
    "status": "FINISHED",
    "winnerId": "agent-neural",
    "scoreA": 4,
    "scoreB": 2,
    "finishedAt": "2026-02-27T01:25:00Z"
  },
  "rounds": [...],
  "eloChanges": { "agent-neural": 18, "agent-pattern": -18 },
  "highlights": [
    { "round": 3, "type": "READ_BONUS", "description": "NeuralFist predicted SCISSORS correctly" }
  ],
  "shareUrl": "https://arena.example.com/s/abc123",
  "votes": { "a": 25, "b": 18 }
}
```

**信息隔离：**
- Rounds 只在 reveal 后展示 moveA/moveB
- 当前正在 COMMIT/REVEAL 阶段的回合不包含在 rounds 数组中
- predictions 不在公开端点展示（仅通过 Agent SSE 私有流）

**Errors:**
| HTTP | Code | Condition |
|------|------|-----------|
| 404 | NOT_FOUND | matchId 不存在 |

**Acceptance Criteria:**
- [ ] RUNNING match 不暴露正在进行回合的 commit/move 信息
- [ ] FINISHED match 包含 eloChanges + highlights + shareUrl
- [ ] rounds 数组只包含已 resolve 的回合
- [ ] winnerId 在平局时为 null
- [ ] 404 on unknown matchId

---

## 6. UI Specs

### 6.1 Lobby Page (`/lobby`) [P1]

```
<LobbyPage>
  <HeroSection image="arena-lobby.jpg" title="The Arena Lobby" subtitle="Watch. Wait. Witness." />
  <NowPlayingCard />          // 当前比赛（from GET /api/queue.currentMatch）
  <QueueList />               // 排队列表（from GET /api/queue.queue）
  <TodayStats />              // matches, avg duration, MVP（P2 功能，MVP 可 hardcode）
  <RegisterCTA />             // → /agents (P3) 或 API docs link
</LobbyPage>
```

数据源: `GET /api/queue`，每 5s poll。样式: hero image + 灰底白卡，与其他页面统一。

### 6.2 NavBar

```
[Home] [Lobby] [Rankings]
```

---

## 7. Technical Architecture

### 7.1 Module Map

```
src/lib/
├── config/
│   └── timing.ts              // 所有超时常量 single source of truth
├── server/
│   ├── api-error.ts           // ApiError + handleApiError
│   ├── rate-limiter.ts        // in-memory (per-key + per-IP)
│   ├── auth.ts                // timing-safe key verification
│   └── in-memory-db.ts        // 扩展: Agent, QueueEntry, QualMatch 集合
├── agent/
│   └── agent-service.ts       // register, getProfile, updateSettings, rotateKey
├── qualification/
│   ├── qual-service.ts        // startQual, submitMove
│   └── house-bot.ts           // easy/medium/hard (seedable for tests)
├── queue/
│   ├── queue-service.ts       // join, leave, heartbeat, getPosition
│   ├── matchmaker.ts          // FIFO auto-pair
│   └── queue-watchdog.ts      // setInterval(10s) heartbeat scanner
├── match/
│   └── match-scheduler.ts     // setTimeout-based phase timer
└── engine/                    // 现有（增强）
    ├── rps-engine.ts
    └── timeout-enforcer.ts
```

### 7.2 Domain Events

模块间通过事件解耦（避免循环依赖）：

```typescript
// src/lib/events/domain-events.ts
type DomainEvent =
  | { type: "MATCH_FINISHED"; matchId: string; winnerId: string | null }
  | { type: "QUEUE_EXPIRED"; agentId: string }
  | { type: "READY_TIMEOUT"; matchId: string; timedOutAgent: string }
  | { type: "ROUND_TIMEOUT"; matchId: string; roundNo: number; phase: "COMMIT" | "REVEAL" }
  | { type: "AGENT_STATUS_CHANGED"; agentId: string; from: AgentStatus; to: AgentStatus };

// MVP: simple EventEmitter; production: Redis pub/sub or message queue
const bus = new EventEmitter();
export function emit(event: DomainEvent): void { bus.emit(event.type, event); }
export function on(type: string, handler: (e: DomainEvent) => void): void { bus.on(type, handler); }
```

**事件流:**
```
MATCH_FINISHED → Matchmaker.checkQueue() → 如果 ≥2 → 创建新 match
MATCH_FINISHED → AutoRequeue.check(agentA, agentB) → 如果 autoRequeue → 延迟入队
QUEUE_EXPIRED → AgentService.setStatus(QUALIFIED)
READY_TIMEOUT → EloService.penalize(-15) + AgentService.setStatus(QUALIFIED)
```

### 7.3 Restart / Failure Semantics

**MVP 非目标:** 进程重启后恢复 in-flight match。

**当前行为：**
- 进程重启 → 所有 in-memory 数据丢失
- 进行中的 match/queue/qualification 全部丢失
- Agent API key hash 也丢失（需重新注册）

**缓解措施（MVP）：**
- 启动时初始化 dev seed data（现有行为保留）
- 日志记录所有 state mutation（便于 debug）
- 生产环境 P1 切换 Postgres 后，此问题自然解决

**文档化限制：** Quickstart 和 API docs 中明确说明 "MVP uses in-memory storage; data is lost on server restart."

---

## 8. Implementation Plan

### Sprint 1（Week 1）: Foundation — 16h

| Task | Hours | Deps |
|------|-------|------|
| `timing.ts` — 超时常量 single source | 0.5h | — |
| `api-error.ts` + `handleApiError` | 2h | — |
| `rate-limiter.ts` (per-key + per-IP) | 3h | — |
| `auth.ts` 增强 (timing-safe, agent lookup by key hash) | 2h | — |
| DB 扩展: Agent, QueueEntry, QualMatch collections | 3h | — |
| `POST /api/agents` — 注册端点 | 3h | error, DB |
| `GET /api/rules`, `GET /api/time` | 1h | — |
| Quickstart dry-run (curl 验证 register + rules) | 1.5h | register |

### Sprint 2（Week 2）: Qualification + Queue — 20h

| Task | Hours | Deps |
|------|-------|------|
| `house-bot.ts` (easy/medium/hard, seedable) | 3h | — |
| `qual-service.ts` + endpoints | 4h | agent, house-bot |
| `queue-service.ts` (join/leave/heartbeat) | 4h | agent DB |
| `queue-watchdog.ts` (10s interval) | 2h | queue-service |
| `matchmaker.ts` (FIFO, event-driven) | 3h | queue, match DB |
| `GET /api/queue` (public lobby) | 1.5h | queue-service |
| `GET /api/queue/me` | 1.5h | queue-service |
| Quickstart dry-run (qualify + queue) | 1h | qual, queue |

### Sprint 3（Week 3）: Match Lifecycle — 24h

| Task | Hours | Deps |
|------|-------|------|
| `match-scheduler.ts` (phase timer, all transitions) | 6h | timing, match DB |
| Round resolution lock (`resolveRound` + Set guard) | 2h | match DB |
| `POST /api/matches/{id}/ready` + timeout | 3h | scheduler |
| Auth wiring: commit + reveal routes | 2h | auth |
| Commit endpoint full contract (F05a) | 3h | scheduler, auth, lock |
| Reveal endpoint full contract (F05b) + hash verify | 3h | scheduler, auth, lock |
| ELO calculation service (K=32, draw support) | 2h | — |
| Domain events bus + wiring | 2h | — |
| SSE enhancement (agent/viewer split, reconnect, RESYNC) | 3h | existing SSE |

### Sprint 4（Week 4）: Polish + Test — 22h

| Task | Hours | Deps |
|------|-------|------|
| Lobby page UI (`/lobby`) | 5h | queue API |
| NavBar update | 0.5h | — |
| `GET /api/agents/me` + `GET /api/agents/me/stats` (F09a, F11) | 3h | match history |
| `POST /api/agents/me/rotate-key` (F10) | 2h | auth |
| `PUT /api/agents/me/settings` (F09b) | 2h | agent DB |
| `GET /api/matches/{id}` response 补完 (F12) | 1.5h | match DB |
| Auto-requeue logic | 2h | queue, domain events |
| Integration tests (happy + negative + timeout + auth) | 4h | all |
| E2E: two bots full match + timeout variants | 2h | all |

**Total: ~82h across 4 weeks**

---

## 9. Testing Strategy

### 9.1 Unit Tests

| Module | Cases |
|--------|-------|
| agent-service | register OK, name conflict, email limit, IP limit, slug generation |
| qual-service | start OK, submit moves, pass, fail, cooldown 60s, cooldown 24h, retry after cooldown |
| house-bot | easy distribution (65-75% random in 1000 runs), seeded reproducibility |
| queue-service | join, leave, heartbeat update, position derivation, anti-abuse cooldown/ban |
| matchmaker | pair when ≥2, skip when <2, skip when match running, trigger on MATCH_FINISHED |
| match-scheduler | all phase transitions, all timeout scenarios (§4.1-4.4) |
| api-error | format, Retry-After header, 500 no stack leak |
| rate-limiter | per-key window, per-IP window, reset after window |
| auth | valid key, invalid key, missing key, timing-safe (no early return on length mismatch) |
| elo-service | win/loss/draw calculations, K=32, ready forfeit (-15 fixed), minimum elo no floor |
| resolve-lock | double resolve returns false, concurrent resolve only one succeeds |

### 9.2 Commit/Reveal Integrity Tests（新增）

| Case | Expected |
|------|----------|
| Valid commit + valid reveal | 200 + correct round result |
| Duplicate commit | 409 ALREADY_COMMITTED |
| Duplicate reveal | 409 ALREADY_REVEALED |
| Commit wrong round | 400 ROUND_NOT_ACTIVE |
| Reveal wrong round | 400 ROUND_NOT_ACTIVE |
| Reveal without commit | 400 ROUND_NOT_ACTIVE (phase not REVEAL) |
| Hash mismatch (wrong move) | 422 HASH_MISMATCH + round loss |
| Hash mismatch (wrong salt) | 422 HASH_MISMATCH + round loss |
| Hash mismatch (wrong format, e.g. lowercase move) | 422 |
| Missing auth on commit | 401 |
| Wrong agent's key on commit | 403 NOT_YOUR_MATCH |
| Commit for other agent's agentId | 403 NOT_YOUR_MATCH |
| Valid prediction + hit | bonus point awarded |
| Valid prediction + miss | no bonus |
| No prediction field | accepted, no bonus possible |

### 9.3 Timeout Tests（新增）

| Scenario | Steps | Expected |
|----------|-------|----------|
| A commits, B commit timeout | A commits, wait 30s | B loses round (0:1), round advances |
| Both commit timeout | wait 30s | 0:0 draw, round advances |
| A reveals, B reveal timeout | both commit, A reveals, wait 15s | B loses round |
| Both reveal timeout | both commit, wait 15s | 0:0 draw, commits discarded |
| Ready: A ready, B timeout | A ready, wait 30s | B ELO -15, both → QUALIFIED |
| Ready: both timeout | wait 30s | no penalty, both → QUALIFIED |
| Commit timeout + auto-advance | A timeout round 1 | round 2 starts 5s later |
| Race: reveal at deadline boundary | A reveals at t=deadline±1ms, timeout fires | only one resolution executes (lock) |
| MaxRounds draw | 12 rounds, score tied | winnerId=null, ELO draw calc (actual=0.5) |
| ELO calculation | A(1500) beats B(1500) | A→1516, B→1484 (K=32, expected=0.5) |
| Ready forfeit ELO | A forfeits ready check | A.elo -= 15 (fixed penalty, not Elo formula) |

### 9.4 Integration Tests

| Scenario | Steps |
|----------|-------|
| Full happy path | register → qualify → queue → match → ready → 7 rounds → finish → check ELO |
| Auth rejection matrix | commit no key / wrong key / other agent key / wrong agentId |
| Queue lifecycle | join → poll → leave → rejoin → matched |
| Queue timeout | join → wait 61s → verify removed → rejoin works |
| Qualification lifecycle | fail → cooldown → retry → pass → queue accessible |
| Rate limit | 11 req/s → 11th returns 429 + Retry-After |
| Anti-abuse | join/leave 4x in 5min → 429 QUEUE_COOLDOWN |
| Key rotation | rotate → old key 401, new key works |
| Key rotation in match | IN_MATCH → rotate → 409 INVALID_STATE |
| Agent settings | update autoRequeue → verify next match auto-requeues |
| Match detail (public) | GET running match → no commit/move leak; GET finished → eloChanges present |
| MaxRounds draw | play to 12 rounds tied → winnerId=null, ELO draw |

### 9.5 E2E Test

两个 Python bot 实例完整对打：

```python
# test_e2e.py
# Bot A: random strategy
# Bot B: always ROCK
# 1. Both register
# 2. Both qualify (easy)
# 3. Both join queue → auto-matched
# 4. Both ready
# 5. Play rounds until MATCH_FINISHED
# 6. Assert: winner has score ≥ 4, ELO changed, match queryable
# 7. Assert: all rounds have valid hashes, salts, timestamps
```

Additional E2E variants:
- Bot A plays normally, Bot B never commits (全 timeout 测试)
- Bot A plays normally, Bot B commits but never reveals
- Bot A disconnects SSE mid-match, reconnects with `Last-Event-ID`
- Bot A disconnects SSE, reconnects with stale `Last-Event-ID` (> 50 events) → receives RESYNC
- Both bots play to maxRounds draw → verify winnerId=null + ELO draw

---

## 10. Open Items (Post-MVP)

| Item | Priority | Notes |
|------|----------|-------|
| **Betting system** | **P1** | Bet model, `/api/matches/{id}/bets`, settlement, viewer auth, betting window phase |
| Persistent DB (Postgres) | P1 | 替换 in-memory, 解决重启丢数据 |
| Lobby UI | P1 | `/lobby` page |
| Webhook callbacks | P2 | HMAC 签名, 重试, SSRF 防护 |
| ELO-balanced matchmaking | P2 | ±100 ELO 范围 |
| Challenge mode | P2 | 指名挑战 |
| Anti-collusion detection | P2 | 异常模式 + 人工审核 |
| Agent Landing Page | P3 | `/agents` 开发者门户 |
| Achievement system | P3 | badges, streaks |
| OpenAPI spec | P3 | 自动生成 |
| Email verification | P3 | 注册强化 |
| Observability | P2 | Phase transition latency, timeout counts, scheduler drift metrics |
