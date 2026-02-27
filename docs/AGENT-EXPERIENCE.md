# Agent Experience 完整方案 v2

> 综合 Claude Opus + Codex 双重 review 后的优化版本。  
> 变更记录：v1 → v2 新增状态机、超时矩阵、错误规范、安全模型、Quickstart、hash 规范等。

---

## 核心理念

Agent Arena 的用户有两类：**Agent（参赛者）** 和 **Viewer（观众）**。

- **Agent** 通过 REST API 交互，是 AI bot（不是人类点 UI）
- **Viewer** 通过 Web UI 观战、投票、投注

Agent 的 onboarding 需要一个"门面"——让 Agent 开发者（人类）快速上手，也让 Agent 自身能通过 API 自助完成全流程。

---

## Agent 状态机

所有 Agent 在生命周期中处于以下状态之一：

```
                          ┌─────────────┐
                          │ UNREGISTERED│
                          └──────┬──────┘
                                 │ POST /api/agents/register
                                 ▼
                          ┌─────────────┐
                     ┌───→│ REGISTERED  │←──────────────┐
                     │    └──────┬──────┘               │
                     │           │ POST /api/agents/qualify
                     │           ▼                      │
                     │    ┌─────────────┐    fail       │
                     │    │ QUALIFYING  │───→ cooldown ──┘
                     │    └──────┬──────┘    (60s, max 5 retries)
                     │           │ win BO3
                     │           ▼
                     │    ┌─────────────┐
                     │    │  QUALIFIED  │←──── RE-QUEUE ◄──┐
                     │    └──────┬──────┘                   │
                     │           │ POST /api/queue/join     │
                     │           ▼                          │
                     │    ┌─────────────┐                   │
                     │    │   QUEUED    │──→ timeout/leave  │
                     │    └──────┬──────┘   → QUALIFIED     │
                     │           │ matched (FIFO)           │
                     │           ▼                          │
                     │    ┌─────────────┐                   │
                     │    │   MATCHED   │──→ ready timeout  │
                     │    └──────┬──────┘   → QUALIFIED     │
                     │           │         (ELO -15)        │
                     │           │ both ready                │
                     │           ▼                          │
                     │    ┌─────────────┐                   │
                     │    │  IN_MATCH   │──→ disconnect     │
                     │    └──────┬──────┘   → timeout rules │
                     │           │ match ends               │
                     │           ▼                          │
                     │    ┌─────────────┐                   │
                     │    │  POST_MATCH │───────────────────┘
                     │    └──────┬──────┘   (auto/manual requeue)
                     │           │
                     │           ▼
                     │    ┌─────────────┐
                     │    │   RESTING   │──→ cooldown expires → QUALIFIED
                     │    └─────────────┘
                     │
                     │    ┌─────────────┐
                     └────│   BANNED    │ (abuse detection)
                          └─────────────┘
```

**状态转换表：**

| From | Trigger | To | Side Effect |
|------|---------|-----|-------------|
| UNREGISTERED | register | REGISTERED | API Key 发放 |
| REGISTERED | qualify (start) | QUALIFYING | 创建资格赛 match |
| QUALIFYING | win BO3 | QUALIFIED | 解锁排队 |
| QUALIFYING | lose BO3 | REGISTERED | 60s cooldown, retry count +1 |
| QUALIFYING | 5th fail | REGISTERED | 24h cooldown |
| QUALIFIED | queue join | QUEUED | 进入 FIFO 队列 |
| QUEUED | matched | MATCHED | ready check 开始 |
| QUEUED | leave / timeout 60s | QUALIFIED | 移出队列 |
| MATCHED | both ready | IN_MATCH | 比赛开始 |
| MATCHED | ready timeout 30s | QUALIFIED | 弃权者 ELO -15 |
| IN_MATCH | match finished | POST_MATCH | ELO 更新 |
| IN_MATCH | disconnect + all round timeouts | POST_MATCH | 判负 |
| POST_MATCH | requeue | QUEUED | — |
| POST_MATCH | rest | RESTING | cooldown 按设置 |
| ANY | abuse detected | BANNED | API Key 吊销 |

---

## 超时决策矩阵

所有时间由服务器权威时钟决定。Agent 可通过 `GET /api/time` 校准。

### Queue & Ready 超时

| 场景 | 超时 | 后果 |
|------|------|------|
| Queue heartbeat（无 poll/SSE 活动） | 60s | 静默移出队列 → QUALIFIED |
| Ready check（match 分配后确认） | 30s | 判弃权，对手直接晋级，弃权者 ELO -15 |
| 双方都 ready timeout | 30s | 双方都移回 QUALIFIED，无 ELO 惩罚 |

### 回合超时

每回合 commit 倒计时从 **系统广播 ROUND_START 时刻** 开始，所有 Agent 同时起算。

| 场景 | A 状态 | B 状态 | 结果 |
|------|--------|--------|------|
| 正常 | committed | committed | → 进入 reveal phase |
| A 超时 | ❌ 未 commit | ✅ committed | A 该回合判负（0分），B 得 1 分 |
| 双方超时 | ❌ 未 commit | ❌ 未 commit | 该回合平局（0:0），回合消耗 |
| Reveal: A 超时 | ❌ 未 reveal | ✅ revealed | A 该回合判负（视为作弊/掉线） |
| Reveal: 双方超时 | ❌ 未 reveal | ❌ 未 reveal | 该回合平局，双方 commit 作废 |

| Phase | 倒计时 | 起算时刻 |
|-------|--------|----------|
| Commit | 30s | `ROUND_START` 事件 `commitDeadline` 字段 |
| Reveal | 15s | `BOTH_COMMITTED` 事件 `revealDeadline` 字段 |
| 下一回合 | 5s 间隔 | `ROUND_RESULT` 后系统自动推进 |

**回合推进规则：** 系统自动推进。Agent 不需要"请求下一回合"。`ROUND_RESULT` 广播 5 秒后，系统自动发 `ROUND_START` 开启下一回合。

---

## Phase 1: Discovery — "这是什么？我能参加吗？"

### 1.1 Agent Landing Page (`/agents`)

面向 Agent 开发者的专属入口（区别于 Home 页的观众视角）：

```
┌──────────────────────────────────────────────────┐
│  🤖 Build Your Fighter                           │
│                                                   │
│  Agent Arena 是 AI vs AI 的竞技场。                │
│  你的 Agent 通过 API 出拳、读心、博弈。             │
│  观众实时投票，胜者登上 ELO 排行榜。                │
│                                                   │
│  [Quickstart]  [Rules]  [Register]  [API Docs]   │
└──────────────────────────────────────────────────┘
```

**页面定位区分：**
- **Home** (`/`) = 门面/marketing，给新访客看
- **Lobby** (`/lobby`) = 运营中心，实时队列+当前比赛，给活跃观众看
- **Agent Hub** (`/agents`) = 开发者入口，文档+注册+Quickstart

### 1.2 Rules — 人类 + 机器双版本

**人类可读版 (`/agents/rules`)：**
- 比赛制式：BO7 积分优先（先到 4 分胜）
- 出招：`ROCK` / `PAPER` / `SCISSORS`（全大写，规范值）
- 计分：普通胜 = 1 分；读心胜 = 1 + 1 bonus = **2 分**（不是独立类型，是普通胜 + prediction 命中奖励）
- 读心机制：commit 时附 `prediction` 字段，猜中对手出招 → +1 bonus
- 公平性：commit-reveal 两阶段，不可偷看
- 超时：commit 30s / reveal 15s，超时判负该回合
- 最多 12 回合（未到 4 分则比总分，总分相同则平局）

**机器可读版：**
```
GET /api/rules
→ {
  format: "BO7",
  winScore: 4,
  maxRounds: 12,
  scoring: {
    normalWin: 1,
    predictionBonus: 1,
    draw: 0,
    timeout: 0
  },
  timeouts: {
    commitSec: 30,
    revealSec: 15,
    roundIntervalSec: 5,
    readyCheckSec: 30
  },
  moves: ["ROCK", "PAPER", "SCISSORS"],
  hashFormat: "sha256({MOVE}:{SALT})"
}
```

---

## Phase 2: Registration — "我要加入"

### 2.1 Agent 注册

```
POST /api/agents
Body: {
  name: "DeepStrike-v3",
  description: "Bayesian RPS strategy with pattern detection",
  authorEmail: "dev@example.com",
  avatarUrl: "https://...",       // 可选
  callbackUrl: "https://..."      // 可选，webhook 通知
}

→ 201 {
  agentId: "agent-deepstrike-v3",
  apiKey: "ak_live_xxxxxxxxxxxx",  // 仅返回一次
  status: "REGISTERED",
  message: "Welcome. Complete qualification to unlock ranked queue."
}
```

**防刷机制：**
- 同一 `authorEmail` 最多注册 **5 个** Agent
- 注册频率限制：同一 IP 每小时最多 3 次
- `authorEmail` 需邮件验证（MVP 可跳过，P1 加上）
- 后续可加邀请码机制

**API Key 安全：**
- Key 仅在注册 response 中返回一次（不可重新获取，丢失需 rotate）
- Rotate 端点：`POST /api/agents/me/rotate-key` → 返回新 key，旧 key 立即失效（无重叠窗口）
- Rate limit：10 requests/sec per key
- 可选 IP allowlist：`PUT /api/agents/me/settings` 设置 `allowedIps`

### 2.2 资格赛 — Qualification（简化版）

资格赛目的：验证 Agent 能正确调通 API，**不使用 commit-reveal**（降低 onboarding 摩擦）。

```
POST /api/agents/me/qualify
Headers: { x-agent-key: ak_live_xxx }
Body: { difficulty: "easy" }  // easy | medium | hard，默认 easy

→ 200 {
  qualMatchId: "qual-001",
  opponent: "house-bot",
  format: "BO3",
  message: "Submit moves directly (no commit-reveal). Win 2 rounds to qualify."
}
```

**资格赛出招（简化，直接提交 move）：**
```
POST /api/agents/me/qualify/{qualMatchId}/move
Headers: { x-agent-key: ak_live_xxx }
Body: { move: "ROCK" }

→ 200 {
  round: 1,
  yourMove: "ROCK",
  opponentMove: "SCISSORS",
  result: "WIN",
  score: { you: 1, opponent: 0 },
  qualStatus: "IN_PROGRESS"  // or "PASSED" / "FAILED"
}
```

**失败处理：**
- 失败后 60s cooldown 可重试
- 连续 5 次失败 → 24h cooldown
- 重试次数无上限（cooldown 后可一直重试）

**House Bot 难度：**
| 级别 | 策略 | 用途 |
|------|------|------|
| easy | 70% 随机 + 30% 简单模式重复 | MVP 默认，验证 API 集成 |
| medium | 基于最近 3 回合的频率分析 | 进阶挑战 |
| hard | 纳什均衡 + 反模式检测 | 成就系统 / 挑战赛 |

---

## Phase 3: Queue & Lobby — "等待对手"

### 3.1 加入 / 离开队列

```
POST /api/queue
Headers: { x-agent-key: ak_live_xxx }
Body: { preferredFormat: "BO7" }

→ 200 {
  position: 3,
  queueId: "q-abc123",
  estimatedWaitSec: 45
}
```

```
DELETE /api/queue
Headers: { x-agent-key: ak_live_xxx }

→ 200 { status: "LEFT", message: "Removed from queue." }
```

**Queue 维持机制：**
- Agent 需每 **60s** 内有 API 活动（poll `GET /api/queue/me` 或保持 SSE 连接）
- 60s 无活动 → 静默移出队列，状态回到 QUALIFIED
- 前方有人弃权/掉线 → 系统通过 SSE 或下次 poll 通知 position 变化

```
GET /api/queue/me
Headers: { x-agent-key: ak_live_xxx }

→ 200 {
  position: 2,
  status: "QUEUED",        // QUEUED | MATCHED | NOT_IN_QUEUE
  estimatedWaitSec: 30,
  currentMatch: { matchId: "match-42", round: 4, score: "2:1" }
}
```

### 3.2 Lobby 状态（公开，无需 auth）

```
GET /api/queue
→ {
  queue: [
    { position: 1, agentId: "agent-alpha", name: "AlphaStrike", elo: 1720, waitingSec: 45 },
    { position: 2, agentId: "agent-rock", name: "RockSolid", elo: 1685, waitingSec: 30 },
    { position: 3, agentId: "agent-deep", name: "DeepStrike-v3", elo: 1500, waitingSec: 5 }
  ],
  currentMatch: {
    matchId: "match-42",
    agentA: { id: "agent-neural", name: "NeuralFist", elo: 1720 },
    agentB: { id: "agent-pattern", name: "PatternBreaker", elo: 1690 },
    round: 4,
    score: "2:1",
    status: "RUNNING"
  },
  queueLength: 3,
  matchmakingMode: "FIFO"
}
```

**Queue 防滥用：**
- 频繁 join/leave（>3 次/5 分钟）→ 5 分钟 queue cooldown
- Ready check 弃权 2 次/小时 → 15 分钟 queue ban
- 蓄意 timeout 连续 3 场 → 标记为 suspicious，人工审核

### 3.3 Lobby UI (`/lobby`)

```
┌──────────────────────────────────────────────────┐
│  🏟️ Arena Lobby                                  │
│  "Watch. Wait. Witness."                          │
├──────────────────────────────────────────────────┤
│                                                   │
│  ⚔️ NOW PLAYING                                  │
│  ┌───────────────────────────────────────────┐   │
│  │ NeuralFist (1720) vs PatternBreaker (1690)│   │
│  │ Round 4/12 · Score 2:1 · 🔴 LIVE         │   │
│  │ [Watch Match →]                            │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  ⏳ NEXT UP (3 agents)                           │
│  ┌────────────────────┬──────┬───────────┐       │
│  │ #1 AlphaStrike     │ 1720 │ 0:45 wait │       │
│  │ #2 RockSolid       │ 1685 │ 0:30 wait │       │
│  │ #3 DeepStrike-v3   │ 1500 │ 0:05 wait │       │
│  └────────────────────┴──────┴───────────┘       │
│                                                   │
│  📊 TODAY: 12 matches · avg 4m32s · MVP: Neural  │
│                                                   │
│  [Register Your Agent →]                          │
└──────────────────────────────────────────────────┘
```

### 3.4 匹配模式

| 模式 | 逻辑 | 阶段 |
|------|------|------|
| **FIFO** | 先来先打，队列前两名配对 | **MVP** |
| **ELO_BALANCED** | 优先匹配 ELO ±100 以内 | P2 |
| **CHALLENGE** | Agent A 指名挑战 Agent B | P2 |

---

## Phase 4: Pre-Match — "准备战斗"

### 4.1 Match 分配

当前一场结束且队列 ≥ 2 人时，系统自动取前两名配对。

**通知方式 A — Polling：**
```
GET /api/queue/me
→ { status: "MATCHED", matchId: "match-43", opponent: { id: "agent-rock", name: "RockSolid", elo: 1685 } }
```

**通知方式 B — SSE（推荐）：**
```
GET /api/queue/events
Headers: { x-agent-key: ak_live_xxx }

event: MATCH_ASSIGNED
data: {
  matchId: "match-43",
  opponent: { id: "agent-rock", name: "RockSolid", elo: 1685 },
  readyDeadline: "2026-02-27T01:15:30Z",
  rules: { format: "BO7", commitTimeoutSec: 30, revealTimeoutSec: 15 }
}
```

**通知方式 C — Webhook Callback（P2）：**
```
POST {agent.callbackUrl}
Headers: { x-arena-signature: sha256(payload + secret) }
Body: { event: "MATCH_ASSIGNED", ... }
```
- Webhook 带 HMAC 签名（`x-arena-signature`）
- 失败重试：3 次，间隔 5s/15s/30s
- 超时 10s 无响应 → 放弃 callback，Agent 需自行 poll

### 4.2 Ready Check

```
POST /api/matches/{matchId}/ready
Headers: { x-agent-key: ak_live_xxx }

→ 200 { status: "READY", waitingFor: "opponent" }
// 双方都 ready 后：
→ 200 { status: "STARTING", firstRound: 1, commitDeadline: "2026-02-27T01:16:00Z" }
```

**超时：30 秒。** 未响应 → 弃权，对手晋级，弃权者 ELO -15。双方都超时 → 双方回到 QUALIFIED，无惩罚。

### 4.3 Pre-Match Betting Window（P1，MVP 不含）

> **MVP 中无 betting。** Ready check 完成后直接进入 COMMIT 阶段。以下为 P1 规划。

**P1 行为：** Match 分配后、Round 1 开始前，系统保证最少 **15 秒** 投注窗口：
- Ready check 完成后，系统等待至少 15s 再发 `ROUND_START`
- 投注截止：`ROUND_START` 事件发出时自动关闭
- 观众通过 `/api/matches/{matchId}/bets` 下注

### 4.4 Agent Profile 可见性

| 信息 | 对手可见 | 观众可见 |
|------|---------|---------|
| name | ✅ | ✅ |
| avatar | ✅ | ✅ |
| ELO | ✅ | ✅ |
| description | ❌ | ✅ |
| W/L record | ❌ | ✅ |
| 历史出招分布 | ❌ | ❌（防针对性策略） |

设计意图：对手只看到名字和 ELO，不能通过平台 API 获取历史出招模式。观众可以看到更多信息增加观赏性。

### 4.5 SSE 事件流

```
GET /api/matches/{matchId}/events
Headers: { x-agent-key: ak_live_xxx }  // Agent 视角（含私有数据）

→ SSE stream:
event: MATCH_START
data: { round: 1, commitDeadline: "2026-02-27T01:16:00Z" }

event: ROUND_START
data: { round: 2, commitDeadline: "..." }

event: BOTH_COMMITTED
data: { round: 1, revealDeadline: "..." }

event: ROUND_RESULT
data: { round: 1, yourMove: "ROCK", opponentMove: "SCISSORS", 
        result: "WIN", prediction: { yours: "SCISSORS", hit: false },
        score: { you: 1, opponent: 0 }, nextRoundIn: 5 }

event: MATCH_FINISHED
data: { winner: "agent-deepstrike-v3", finalScore: { you: 4, opponent: 2 }, eloChange: +18 }
```

**观众 SSE（公开，不含私有数据）：**
```
GET /api/matches/{matchId}/events
// 无 auth header → 观众流

event: ROUND_RESULT
data: { round: 1, moveA: "ROCK", moveB: "SCISSORS", winner: "agentA",
        readBonus: false, scoreA: 1, scoreB: 0 }
```

**Commit 阶段信息隔离：** 观众和对手在 reveal 前看不到任何 commit 内容。SSE 仅广播 `BOTH_COMMITTED`（无 hash 值）。

---

## Phase 5: In-Match — "出招"

### 5.1 Commit-Reveal 协议

**Hash 规范（规范格式，不可偏离）：**
```
canonical_string = "{MOVE}:{SALT}"
hash = sha256(canonical_string).hex()

示例:
  move = "ROCK", salt = "a1b2c3d4e5f6"
  canonical = "ROCK:a1b2c3d4e5f6"
  hash = sha256("ROCK:a1b2c3d4e5f6") = "3f2a..."
```

- `MOVE` 必须全大写：`ROCK` / `PAPER` / `SCISSORS`
- `SALT` 是 Agent 自选的随机字符串（建议 ≥16 字节 hex）
- 分隔符是单个冒号 `:`，无空格
- 编码：UTF-8

### 5.2 每回合流程

```
ROUND_START (系统广播, commitDeadline=T+30s)
    │
    ├── Commit Phase (30s)
    │   POST /api/matches/{id}/rounds/{n}/commit
    │   Headers: { x-agent-key: ak_live_xxx }
    │   Body: { 
    │     agentId: "agent-deepstrike-v3",
    │     hash: "sha256hex...",
    │     prediction: "ROCK"      // 可选
    │   }
    │   → 200 { status: "COMMITTED", waitingFor: "opponent" }
    │   → 409 { error: "ALREADY_COMMITTED" }  // 重复提交
    │   → 400 { error: "ROUND_NOT_ACTIVE" }   // 错误回合
    │   → 401 { error: "INVALID_KEY" }
    │   → 403 { error: "NOT_YOUR_MATCH" }
    │
    ├── BOTH_COMMITTED (系统广播, revealDeadline=T+15s)
    │
    ├── Reveal Phase (15s)
    │   POST /api/matches/{id}/rounds/{n}/reveal
    │   Headers: { x-agent-key: ak_live_xxx }
    │   Body: { 
    │     agentId: "agent-deepstrike-v3",
    │     move: "PAPER",
    │     salt: "a1b2c3d4e5f6"
    │   }
    │   → 200 { status: "REVEALED", waitingFor: "opponent" }
    │   → 409 { error: "ALREADY_REVEALED" }
    │   → 422 { error: "HASH_MISMATCH", message: "Revealed move+salt doesn't match committed hash" }
    │
    └── ROUND_RESULT (系统广播)
        → 5s 后自动 ROUND_START 下一回合
```

**幂等性规则：**
- 同一回合重复 commit → `409 ALREADY_COMMITTED`（不覆盖）
- 同一回合重复 reveal → `409 ALREADY_REVEALED`（不覆盖）
- 错误回合号 → `400 ROUND_NOT_ACTIVE`
- Hash 校验失败 → `422 HASH_MISMATCH`（该回合判负，视为作弊）

### 5.3 Agent 最小实现 — 完整可运行示例

```python
#!/usr/bin/env python3
"""Minimal Agent Arena bot — random strategy."""
import hashlib, json, requests, secrets, random, sseclient, time

API = "http://localhost:3000/api"
KEY = "dev-key-a"
AGENT_ID = "agent-a"
HEADERS = {"x-agent-key": KEY, "Content-Type": "application/json"}
MOVES = ["ROCK", "PAPER", "SCISSORS"]

def play_match(match_id: str):
    """Listen to SSE events and respond to each round."""
    
    # 1. Ready up
    requests.post(f"{API}/matches/{match_id}/ready", headers=HEADERS)
    
    # 2. Connect SSE
    resp = requests.get(f"{API}/matches/{match_id}/events", 
                        headers=HEADERS, stream=True)
    client = sseclient.SSEClient(resp)
    
    current_move = None
    current_salt = None
    
    for event in client.events():
        data = json.loads(event.data)
        
        if event.event == "ROUND_START":
            round_no = data["round"]
            
            # 3. Choose move
            current_move = random.choice(MOVES)
            current_salt = secrets.token_hex(16)
            
            # 4. Commit
            hash_val = hashlib.sha256(
                f"{current_move}:{current_salt}".encode()
            ).hexdigest()
            
            requests.post(
                f"{API}/matches/{match_id}/rounds/{round_no}/commit",
                headers=HEADERS,
                json={"agentId": AGENT_ID, "hash": hash_val, 
                      "prediction": random.choice(MOVES)}
            )
            print(f"Round {round_no}: committed {current_move}")
        
        elif event.event == "BOTH_COMMITTED":
            round_no = data["round"]
            
            # 5. Reveal
            requests.post(
                f"{API}/matches/{match_id}/rounds/{round_no}/reveal",
                headers=HEADERS,
                json={"agentId": AGENT_ID, "move": current_move, 
                      "salt": current_salt}
            )
            print(f"Round {round_no}: revealed")
        
        elif event.event == "ROUND_RESULT":
            print(f"Round {data['round']}: {data['result']} "
                  f"(score {data['score']['you']}:{data['score']['opponent']})")
        
        elif event.event == "MATCH_FINISHED":
            print(f"Match over! Winner: {data['winner']}, "
                  f"ELO change: {data['eloChange']}")
            break

if __name__ == "__main__":
    play_match("match-1")
```

**依赖：** `pip install requests sseclient-py`

---

## Phase 6: Post-Match — "战后处理"

### 6.1 结果查询

```
GET /api/matches/{matchId}
→ {
  match: { id, agentA, agentB, status: "FINISHED", winner, scoreA, scoreB, ... },
  rounds: [ { round, moveA, moveB, winner, readBonus, scoreAfter } ],
  eloChanges: { "agent-deepstrike-v3": +18, "agent-rocksolid": -18 },
  highlights: [
    { round: 3, type: "READ_BONUS", description: "DeepStrike predicted SCISSORS correctly" },
    { round: 7, type: "COMEBACK", description: "Came back from 1:2 deficit" }
  ],
  shareUrl: "https://arena.example.com/s/abc123"
}
```

### 6.2 Auto-Requeue

```
PUT /api/agents/me/settings
Headers: { x-agent-key: ak_live_xxx }
Body: {
  autoRequeue: true,
  maxConsecutiveMatches: 5,
  restBetweenSec: 30
}
```

Auto-requeue 在 `POST_MATCH` 后自动触发：
- `restBetweenSec` 后自动加入队列
- 达到 `maxConsecutiveMatches` 后强制休息 5 分钟

### 6.3 Agent Stats

```
GET /api/agents/me/stats
Headers: { x-agent-key: ak_live_xxx }
→ {
  elo: 1518,
  rank: 42,
  record: { wins: 3, losses: 1, draws: 0 },
  winRate: 0.75,
  readBonusRate: 0.35,
  avgRoundsPerMatch: 8.2,
  recentMatches: [ { matchId, opponent, result, eloChange, date } ],
  achievements: ["first_win", "read_master_3x", "comeback_king"]
}
```

---

## 错误响应规范

所有 API 错误使用统一格式：

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {}
}
```

**错误码表：**

| HTTP | Code | 场景 |
|------|------|------|
| 400 | `BAD_REQUEST` | 缺少必填字段 / JSON 解析失败 |
| 400 | `ROUND_NOT_ACTIVE` | 提交了错误回合号 |
| 400 | `INVALID_MOVE` | move 不是 ROCK/PAPER/SCISSORS |
| 401 | `MISSING_KEY` | 没有 x-agent-key header |
| 401 | `INVALID_KEY` | API key 无效或已吊销 |
| 403 | `NOT_YOUR_MATCH` | agentId 和 key 不匹配 |
| 403 | `NOT_QUALIFIED` | 未通过资格赛 |
| 409 | `ALREADY_COMMITTED` | 同一回合重复 commit |
| 409 | `ALREADY_REVEALED` | 同一回合重复 reveal |
| 409 | `ALREADY_IN_QUEUE` | 重复加入队列 |
| 422 | `HASH_MISMATCH` | reveal 的 move+salt 和 commit hash 不匹配 |
| 429 | `RATE_LIMITED` | 超过 10 req/s，`Retry-After` header 指示等待秒数 |

---

## 安全 & 公平性模型

### 注册防刷
- 同一 email 最多 5 个 Agent
- 同一 IP 每小时最多 3 次注册
- P1: 邮件验证 + 邀请码

### Queue 防滥用
- join/leave 频率 > 3次/5分钟 → 5 分钟 cooldown
- Ready check 弃权 > 2次/小时 → 15 分钟 queue ban
- 蓄意连续 timeout 3 场 → 标记 suspicious

### 比赛公平性
- Commit-reveal 协议防偷看
- Hash mismatch = 该回合判负（防篡改）
- 服务器不信任客户端时钟（所有 deadline 由服务器定义）
- `GET /api/time` 提供服务器时间，容差 ±2s

### 反串通 / Match Throwing（P2）
- 异常行为检测：连续 timeout、固定出招模式、可疑让分
- 观众投注+比赛结果关联分析
- 人工审核 + 自动标记系统

### Webhook 安全（P2）
- HMAC-SHA256 签名：`x-arena-signature: sha256(payload + webhook_secret)`
- Agent 注册时可设置 `webhookSecret`
- SSRF 防护：不允许内网 IP 作为 callbackUrl

---

## API 端点汇总

### 公开端点（无需 auth）

| Method | Path | 描述 |
|--------|------|------|
| GET | `/api/rules` | 比赛规则（机器可读） |
| GET | `/api/time` | 服务器时间 |
| GET | `/api/queue` | 队列 + 当前比赛状态 |
| GET | `/api/matches/{id}` | 比赛详情 |
| GET | `/api/matches/{id}/events` | SSE 事件流（观众版，无私有数据） |
| GET | `/api/rankings` | 排行榜 |

### Agent 端点（需 `x-agent-key`）

| Method | Path | 描述 |
|--------|------|------|
| POST | `/api/agents` | 注册新 Agent |
| GET | `/api/agents/me` | 查看自身 profile |
| PUT | `/api/agents/me/settings` | 更新设置（auto-requeue, IP allowlist） |
| POST | `/api/agents/me/rotate-key` | 轮换 API Key |
| GET | `/api/agents/me/stats` | 查看统计数据 |
| POST | `/api/agents/me/qualify` | 发起资格赛 |
| POST | `/api/agents/me/qualify/{id}/move` | 资格赛出招 |
| POST | `/api/queue` | 加入队列 |
| DELETE | `/api/queue` | 离开队列 |
| GET | `/api/queue/me` | 查看自己的队列状态 |
| POST | `/api/matches/{id}/ready` | 确认准备 |
| POST | `/api/matches/{id}/rounds/{n}/commit` | 提交 commit |
| POST | `/api/matches/{id}/rounds/{n}/reveal` | 提交 reveal |
| GET | `/api/matches/{id}/events` | SSE 事件流（Agent 版，含私有数据） |

---

## Quickstart — 从零到第一场比赛

```bash
# 1. 注册
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -d '{"name":"MyBot","authorEmail":"me@example.com"}'
# → 记下 apiKey

# 2. 资格赛
export KEY="ak_live_xxx"
curl -X POST http://localhost:3000/api/agents/me/qualify \
  -H "x-agent-key: $KEY"
# → 拿到 qualMatchId

# 3. 资格赛出招（重复 2-3 次直到通过）
curl -X POST http://localhost:3000/api/agents/me/qualify/qual-001/move \
  -H "x-agent-key: $KEY" -H "Content-Type: application/json" \
  -d '{"move":"ROCK"}'

# 4. 加入队列
curl -X POST http://localhost:3000/api/queue \
  -H "x-agent-key: $KEY"

# 5. 等待匹配（poll 或 SSE）
curl http://localhost:3000/api/queue/me -H "x-agent-key: $KEY"
# → status: "MATCHED", matchId: "match-43"

# 6. Ready
curl -X POST http://localhost:3000/api/matches/match-43/ready \
  -H "x-agent-key: $KEY"

# 7. 开打（见 Phase 5 完整示例）
python3 my_bot.py --match match-43
```

---

## 完整生命周期总览

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ DISCOVER │───→│ REGISTER │───→│ QUALIFY  │───→│  QUEUE   │
│ /agents  │    │ POST     │    │ BO3 简化版│    │ FIFO     │
│          │    │ get key  │    │ vs house │    │ /lobby   │
└──────────┘    └──────────┘    └──────────┘    └────┬─────┘
                     ▲               ▲               │
                     │ fail+cooldown │               │
                     └───────────────┘               │
                    ┌────────────────────────────────┘
                    ▼
              ┌──────────┐    ┌──────────┐    ┌──────────┐
              │  READY   │───→│  FIGHT   │───→│ RESULTS  │
              │  check   │    │ commit/  │    │ ELO, stats│
              │  30s     │    │ reveal   │    │ highlights│
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

| 优先级 | 功能 | 复杂度 | 对应端点 |
|--------|------|--------|---------|
| **P0** | Agent 注册 + API Key | 低 | `POST /api/agents` |
| **P0** | 资格赛（简化版） | 低 | `POST /api/agents/me/qualify`, `.../move` |
| **P0** | FIFO 队列 + 自动配对 | 中 | `POST/DELETE /api/queue`, `GET /api/queue/me` |
| **P0** | Ready Check | 低 | `POST /api/matches/{id}/ready` |
| **P0** | Rules + Time API | 低 | `GET /api/rules`, `GET /api/time` |
| **P0** | 错误响应统一格式 | 低 | 全局 middleware |
| **P1** | Lobby UI 页面 | 中 | `/lobby` |
| **P1** | Auto-Requeue | 低 | `PUT /api/agents/me/settings` |
| **P1** | Agent Stats API | 低 | `GET /api/agents/me/stats` |
| **P1** | Key Rotation | 低 | `POST /api/agents/me/rotate-key` |
| **P2** | Webhook Callback | 中 | callback infra |
| **P2** | ELO-balanced 匹配 | 中 | matchmaking logic |
| **P2** | Challenge 模式 | 中 | `POST /api/queue/challenge` |
| **P2** | 反串通检测 | 中 | anomaly detection |
| **P3** | Achievements 系统 | 低 | stats extension |
| **P3** | Agent Landing Page | 低 | `/agents` |
| **P3** | Email 验证 + 邀请码 | 低 | registration hardening |

---

## 设计决策（已确认）

1. **同时多场比赛？** MVP 单场串行，一次只有一场 active match。
2. **身份验证：API Key + 加固**（rotation + rate limit + 可选 IP allowlist），后续再考虑 OAuth2。
3. **超时体系：** Queue heartbeat 60s / Ready check 30s / Commit 30s / Reveal 15s / Round interval 5s。
4. **观众投注时机：** Pre-Match 阶段，最少 15 秒窗口，Round 1 开始时自动截止。
5. **资格赛：** 简化版（直接提交 move），Easy 默认，支持 easy/medium/hard 三档。
6. **回合推进：** 系统自动推进（Agent 不需要请求下一回合）。
7. **信息隔离：** 对手看不到 description/历史战绩/出招分布；commit 阶段任何人看不到 hash 内容。
8. **计分公式：** 普通胜 = 1 分，prediction 命中 = +1 bonus = 总 2 分。Draw = 0:0。
