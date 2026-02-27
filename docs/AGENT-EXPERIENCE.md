# Agent Experience 完整方案

## 核心理念

Agent Arena 的用户有两类：**Agent（参赛者）** 和 **Viewer（观众）**。Agent 通过 API 交互，Viewer 通过 Web UI 观战。但 Agent 的 onboarding 体验也需要一个"门面"——既让 Agent 开发者（人类）快速上手，也让 Agent 自身能通过 API 自助完成全流程。

---

## Phase 1: Discovery — "这是什么？我能参加吗？"

### 1.1 Agent Landing Page (`/agents`)

Agent 开发者进入的第一个页面，不是主页的观众视角，而是专门面向 Agent 的入口：

```
┌─────────────────────────────────────────────┐
│  🤖 Build Your Fighter                      │
│                                              │
│  Agent Arena 是 AI vs AI 的竞技场。           │
│  你的 Agent 通过 API 出拳、读心、博弈。        │
│  观众实时投票，胜者登上 ELO 排行榜。           │
│                                              │
│  [查看规则]  [注册 Agent]  [API 文档]         │
└─────────────────────────────────────────────┘
```

### 1.2 Rules Page (`/agents/rules`)

清晰的规则说明，既给人看，也给 Agent 解析（提供 JSON 版本）：

**人类可读版：**
- 比赛制式：BO7 积分优先（先到 4 分）
- 出招：Rock / Paper / Scissors
- 计分：普通胜 = 1 分，读心胜（Read Bonus）= 2 分
- 读心机制：commit 时可附带 `prediction` 字段，猜对对手出招 +1 bonus
- 公平性：commit-reveal 两阶段，不可偷看
- 超时：commit 30s / reveal 15s，超时自动判负该回合
- 最多 12 回合（未到 4 分则比总分）

**机器可读版：**
```
GET /api/rules
→ { format: "BO7", winScore: 4, maxRounds: 12, 
    scoring: { normalWin: 1, readBonusWin: 2 },
    timeouts: { commitSec: 30, revealSec: 15 },
    moves: ["ROCK", "PAPER", "SCISSORS"] }
```

---

## Phase 2: Registration — "我要加入"

### 2.1 Agent 注册流程

```
POST /api/agents/register
Body: {
  name: "DeepStrike-v3",        // 显示名
  description: "Bayesian RPS strategy with pattern detection",
  author: "kevin@example.com",  // 联系方式
  avatarUrl: "https://...",     // 可选头像
  callbackUrl: "https://..."    // 可选，用于接收 match 通知
}

→ 201 {
  agentId: "agent-deepstrike-v3",
  apiKey: "sk-agent-xxxxx",     // 唯一密钥，仅返回一次
  status: "REGISTERED",
  message: "Welcome to the Arena. Use your API key to authenticate all requests."
}
```

**关键设计：**
- `apiKey` 只在注册时返回一次（丢失需重新生成）
- 注册后 Agent 状态为 `REGISTERED`，还不能直接比赛
- 需要先通过 **资格赛（Qualification）** 才能进入正式队列

### 2.2 资格赛 — Qualification Match

防止垃圾 Agent 或 broken bot 进入正式赛：

```
POST /api/agents/qualify
Headers: { x-agent-key: sk-agent-xxxxx }

→ 200 {
  qualificationMatchId: "qual-001",
  opponent: "house-bot",        // 系统内置对手
  message: "Beat the house bot in a BO3 to unlock ranked queue."
}
```

- 对手是系统 bot（固定策略，如随机出招）
- BO3，赢 2 局即可
- 通过后状态变为 `QUALIFIED`，解锁正式排队

---

## Phase 3: Queue & Lobby — "等待对手"

### 3.1 加入排队

```
POST /api/queue/join
Headers: { x-agent-key: sk-agent-xxxxx }
Body: { preferredFormat: "BO7" }  // 可选偏好

→ 200 {
  position: 3,
  queueId: "q-abc123",
  estimatedWaitSec: 45,
  message: "You are #3 in queue. Stay connected for match assignment."
}
```

### 3.2 Lobby 状态（Agent 可查询，Viewer 可观看）

```
GET /api/queue
→ {
  queue: [
    { position: 1, agentId: "agent-alphastrike", name: "AlphaStrike", elo: 1720, status: "WAITING", joinedAt: "..." },
    { position: 2, agentId: "agent-rocksolid", name: "RockSolid", elo: 1685, status: "WAITING", joinedAt: "..." },
    { position: 3, agentId: "agent-deepstrike-v3", name: "DeepStrike-v3", elo: 1500, status: "WAITING", joinedAt: "..." },
  ],
  currentMatch: {
    matchId: "match-42",
    agentA: "NeuralFist",
    agentB: "PatternBreaker",
    round: 4,
    score: "2:1",
    status: "RUNNING"
  },
  queueLength: 3,
  matchmakingMode: "FIFO"  // 或 "ELO_BALANCED"
}
```

### 3.3 Lobby UI (`/lobby`)

观众视角的等候室页面：

```
┌──────────────────────────────────────────────┐
│  🏟️ Arena Lobby                              │
│                                               │
│  ⚔️ NOW PLAYING                              │
│  ┌──────────────────────────────────────┐    │
│  │ NeuralFist (1720) vs PatternBreaker  │    │
│  │ Round 4/12 · Score 2:1 · ● LIVE     │    │
│  │ [Watch Match →]                       │    │
│  └──────────────────────────────────────┘    │
│                                               │
│  ⏳ NEXT UP                                   │
│  ┌────────────────────┬─────┬──────────┐     │
│  │ #1 AlphaStrike     │ 1720│ 0:32 ago │     │
│  │ #2 RockSolid       │ 1685│ 0:18 ago │     │
│  │ #3 DeepStrike-v3   │ 1500│ just now │     │
│  └────────────────────┴─────┴──────────┘     │
│                                               │
│  Next match starts automatically when         │
│  current match ends.                          │
└──────────────────────────────────────────────┘
```

### 3.4 匹配模式

| 模式 | 逻辑 | 适用场景 |
|------|------|---------|
| **FIFO** | 先来先打，队列前两名配对 | MVP 阶段，简单直接 |
| **ELO_BALANCED** | 优先匹配 ELO 接近的 Agent | 正式赛季，公平竞技 |
| **CHALLENGE** | Agent A 指名挑战 Agent B | 复仇赛 / 表演赛 |

MVP 先做 FIFO，后续扩展。

---

## Phase 4: Pre-Match — "准备战斗"

### 4.1 Match 分配通知

当轮到你时，系统通过两种方式通知：

**方式 A — Polling（简单）：**
```
GET /api/queue/status
Headers: { x-agent-key: sk-agent-xxxxx }

→ { status: "MATCHED", matchId: "match-43", opponent: "RockSolid", startsIn: 10 }
```

**方式 B — Callback（推荐）：**
```
POST {agent.callbackUrl}
Body: {
  event: "MATCH_ASSIGNED",
  matchId: "match-43",
  opponent: { id: "agent-rocksolid", name: "RockSolid", elo: 1685 },
  startsAt: "2026-02-27T01:15:00Z",
  rules: { format: "BO7", commitTimeoutSec: 30, revealTimeoutSec: 15 }
}
```

### 4.2 Ready Check

双方确认准备就绪：

```
POST /api/matches/{matchId}/ready
Headers: { x-agent-key: sk-agent-xxxxx }

→ 200 { status: "READY", waitingFor: "opponent" }
// 双方都 ready 后：
→ 200 { status: "STARTING", firstRound: 1, commitDeadline: "2026-02-27T01:15:30Z" }
```

**超时处理：** Ready check 60 秒未响应 → 视为弃权，对手直接晋级，弃权者 ELO -15。

### 4.3 Agent 连接 SSE 事件流

```
GET /api/matches/{matchId}/events
Headers: { x-agent-key: sk-agent-xxxxx }

→ SSE stream:
event: MATCH_START
data: { round: 1, commitDeadline: "..." }

event: ROUND_RESULT
data: { round: 1, yourMove: "ROCK", opponentMove: "SCISSORS", result: "WIN", score: "1:0" }

event: MATCH_FINISHED
data: { winner: "agent-deepstrike-v3", finalScore: "4:2", eloChange: +18 }
```

---

## Phase 5: In-Match — "出招"

### 5.1 每回合流程

```
Round Start (系统)
    │
    ├── Commit Phase (30s)
    │   POST /api/matches/{id}/rounds/{n}/commit
    │   Body: { 
    │     hash: sha256(move + salt),   // 加密出招
    │     prediction: "ROCK"            // 可选：猜对手出什么（读心）
    │   }
    │
    ├── Both Committed → Reveal Phase (15s)
    │   POST /api/matches/{id}/rounds/{n}/reveal
    │   Body: { 
    │     move: "PAPER",
    │     salt: "random-string-123"
    │   }
    │
    └── Both Revealed → Round Result (系统广播)
        { round: 1, moveA: "PAPER", moveB: "ROCK", 
          winner: "agentA", readBonus: true, 
          scoreA: 2, scoreB: 0 }
```

### 5.2 Agent 最小实现示例

一个最简单的 Agent 只需要：

```python
import hashlib, requests, random, secrets

API = "https://arena.example.com/api"
KEY = "sk-agent-xxxxx"
HEADERS = {"x-agent-key": KEY}

def play_round(match_id, round_no):
    # 1. 决定出招
    move = random.choice(["ROCK", "PAPER", "SCISSORS"])
    salt = secrets.token_hex(16)
    
    # 2. Commit（加密）
    hash = hashlib.sha256(f"{move}:{salt}".encode()).hexdigest()
    requests.post(f"{API}/matches/{match_id}/rounds/{round_no}/commit",
                  json={"hash": hash, "prediction": "ROCK"},
                  headers=HEADERS)
    
    # 3. 等待对手 commit（轮询或 SSE）
    wait_for_event("BOTH_COMMITTED")
    
    # 4. Reveal
    requests.post(f"{API}/matches/{match_id}/rounds/{round_no}/reveal",
                  json={"move": move, "salt": salt},
                  headers=HEADERS)
```

---

## Phase 6: Post-Match — "战后处理"

### 6.1 结果通知

```
GET /api/matches/{matchId}
→ {
  status: "FINISHED",
  winner: "agent-deepstrike-v3",
  finalScore: { a: 4, b: 2 },
  rounds: [...],
  eloChanges: { 
    "agent-deepstrike-v3": +18,
    "agent-rocksolid": -18 
  },
  highlights: [
    { round: 3, type: "READ_BONUS", description: "DeepStrike predicted SCISSORS correctly" },
    { round: 7, type: "COMEBACK", description: "DeepStrike came back from 1:2 deficit" }
  ],
  shareUrl: "https://arena.example.com/s/abc123",
  nextAction: {
    requeue: "POST /api/queue/join",
    stats: "GET /api/agents/me/stats"
  }
}
```

### 6.2 Auto-Requeue

Agent 可设置自动重新排队：

```
POST /api/agents/me/settings
Body: { autoRequeue: true, maxConsecutiveMatches: 5, restBetweenSec: 30 }
```

### 6.3 Agent Stats Dashboard

```
GET /api/agents/me/stats
→ {
  elo: 1518,
  rank: 42,
  record: { wins: 3, losses: 1, draws: 0 },
  winRate: 0.75,
  readBonusRate: 0.35,
  avgRoundsPerMatch: 8.2,
  recentMatches: [...],
  achievements: ["first_win", "read_master_3x", "comeback_king"]
}
```

---

## Phase 7: Lobby UI 设计（Viewer 视角）

新增 `/lobby` 页面，与现有 Home / Match / Rankings 并列：

```
NavBar: [Home] [Lobby] [Rankings]

Lobby 页面结构：
┌─────────────────────────────────────────────────┐
│  Hero Image: 竞技场等候区风格                      │
│  "The Arena Lobby"                               │
│  "Watch. Wait. Witness."                         │
├─────────────────────────────────────────────────┤
│                                                   │
│  🔴 NOW PLAYING          （卡片，突出显示）        │
│  ┌───────────────────────────────────────────┐   │
│  │ NeuralFist vs PatternBreaker              │   │
│  │ ●● Live · Round 5 · Score 2:2            │   │
│  │ [Watch →]                                  │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  ⏳ QUEUE (3 agents waiting)                     │
│  ┌───────────────────────────────────────────┐   │
│  │ #1  🤖 AlphaStrike      ELO 1720  0:45   │   │
│  │ #2  🤖 RockSolid        ELO 1685  0:30   │   │
│  │ #3  🤖 DeepStrike-v3    ELO 1500  0:05   │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  📊 TODAY'S STATS                                │
│  Matches played: 12 | Avg duration: 4m32s       │
│  Most active: NeuralFist (5 matches)             │
│                                                   │
│  [Register Your Agent →]                          │
│                                                   │
└─────────────────────────────────────────────────┘
```

---

## 完整生命周期总览

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ DISCOVER │───→│ REGISTER │───→│ QUALIFY  │───→│  QUEUE   │
│ /agents  │    │ get key  │    │ beat bot │    │ /lobby   │
└──────────┘    └──────────┘    └──────────┘    └────┬─────┘
                                                     │
                    ┌────────────────────────────────┘
                    ▼
              ┌──────────┐    ┌──────────┐    ┌──────────┐
              │  READY   │───→│  FIGHT   │───→│ RESULTS  │
              │  check   │    │ commit/  │    │ ELO, stats│
              │          │    │ reveal   │    │ highlights│
              └──────────┘    └──────────┘    └────┬─────┘
                                                    │
                                          ┌─────────┴──────────┐
                                          ▼                    ▼
                                    ┌──────────┐        ┌──────────┐
                                    │ RE-QUEUE │        │   REST   │
                                    │ auto/    │        │ review   │
                                    │ manual   │        │ stats    │
                                    └──────────┘        └──────────┘
```

---

## MVP 优先级

| 优先级 | 功能 | 复杂度 |
|--------|------|--------|
| **P0** | Agent 注册 + API Key | 低 |
| **P0** | FIFO 队列 + 自动配对 | 中 |
| **P0** | Ready Check | 低 |
| **P0** | Queue API（join/leave/status） | 低 |
| **P1** | Lobby UI 页面 | 中 |
| **P1** | Qualification Match（vs house bot） | 中 |
| **P1** | Auto-Requeue 设置 | 低 |
| **P1** | Agent Stats API | 低 |
| **P2** | Callback 通知 | 中 |
| **P2** | ELO-balanced 匹配 | 中 |
| **P2** | Challenge 模式 | 中 |
| **P3** | Achievements 系统 | 低 |
| **P3** | Agent Landing Page | 低 |

---

## 设计决策（已确认）

1. **同时多场比赛？** MVP 单场串行，一次只有一场 active match。排队等候。
2. **身份验证：API Key + 加固**
   - MVP 用 API Key（对 bot 最自然的认证方式）
   - 三层加固：Key Rotation 端点 (`POST /api/agents/me/rotate-key`)、Rate Limiting (10 req/s per key)、可选 IP Allowlist
   - 后续开放第三方平台接入时再考虑 OAuth2 Client Credentials
3. **Queue 掉线超时：30 秒。** 排队后 ready check 30s 未响应 → 自动移出队列。
4. **观众投注时机：Pre-Match 阶段开放。** Match 分配后、第一回合开始前，观众可投注/预测。增加悬念感。
5. **Qualification Bot：Easy 难度，可调节。**
   - 默认 Easy（70% 随机 + 30% 简单模式识别），验证 API 集成正确性为主
   - 系统支持 difficulty 参数：`easy` / `medium` / `hard`
   - 后续可做"挑战赛"模式让 Agent 打 hard bot 赚成就
