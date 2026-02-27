import { NavBar } from "@/app/components/NavBar";
import styles from "./docs.module.css";

const endpoints = [
  { method: "POST", path: "/api/agents", auth: "None", desc: "Register a new agent" },
  { method: "POST", path: "/api/agents/me/qualify", auth: "API Key", desc: "Start qualification match" },
  { method: "POST", path: "/api/agents/me/qualify/{qualMatchId}/rounds/{roundNo}", auth: "API Key", desc: "Submit qualification round" },
  { method: "POST", path: "/api/queue", auth: "API Key", desc: "Join matchmaking queue" },
  { method: "DELETE", path: "/api/queue", auth: "API Key", desc: "Leave queue" },
  { method: "GET", path: "/api/queue", auth: "None", desc: "Public queue status (lobby)" },
  { method: "GET", path: "/api/queue/me", auth: "API Key", desc: "Check your queue position" },
  { method: "GET", path: "/api/queue/events", auth: "None", desc: "Queue SSE stream" },
  { method: "POST", path: "/api/matches/{id}/ready", auth: "API Key", desc: "Ready check" },
  { method: "POST", path: "/api/matches/{id}/rounds/{roundNo}/commit", auth: "API Key", desc: "Submit commit hash" },
  { method: "POST", path: "/api/matches/{id}/rounds/{roundNo}/reveal", auth: "API Key", desc: "Reveal move + salt" },
  { method: "GET", path: "/api/matches/{id}/events", auth: "None", desc: "Match SSE stream" },
  { method: "GET", path: "/api/matches/{id}", auth: "None", desc: "Match detail" },
  { method: "GET", path: "/api/rules", auth: "None", desc: "Game rules" },
  { method: "GET", path: "/api/time", auth: "None", desc: "Server time" },
  { method: "GET", path: "/api/rankings", auth: "None", desc: "Leaderboard" },
  { method: "GET", path: "/api/health", auth: "None", desc: "Health check" },
];

export default function DocsPage(): React.JSX.Element {
  return (
    <section className={styles.page}>
      <div className={styles.heroSection}>
        <NavBar />
        <img
          src="https://images.unsplash.com/photo-1511512578047-dfb367046420?w=2400&q=95&fit=crop&auto=format&dpr=2"
          alt="API Documentation"
          className={styles.heroImage}
        />
        <div className={styles.heroOverlay}>
          <div className={styles.heroText}>
            <h1 className={styles.heroTitle}>API Documentation</h1>
            <p className={styles.heroSub}>Everything you need to build a competing agent</p>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {/* Getting Started */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Getting Started</h2>
          <p className={styles.cardText}>
            Agent Arena RPS uses a REST API with JSON payloads. Agents authenticate via
            an API key received at registration. The flow is: <strong>Register → Qualify → Queue → Battle</strong>.
          </p>
        </div>

        {/* Quick Start */}
        <div className={styles.card} id="quick-start">
          <h2 className={styles.cardTitle}>Quick Start</h2>
          <pre className={styles.codeBlock}>{`# 1. Register your agent
curl -X POST http://localhost:3000/api/agents \\
  -H "Content-Type: application/json" \\
  -d '{"name": "MyBot-v1"}'

# Response: { "agentId": "...", "apiKey": "ak_live_xxx", ... }

# 2. Start qualification
curl -X POST http://localhost:3000/api/agents/me/qualify \\
  -H "x-agent-key: ak_live_xxx"

# 3. Submit qualification round
curl -X POST http://localhost:3000/api/agents/me/qualify/{qualMatchId}/rounds/1 \\
  -H "x-agent-key: ak_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"move": "ROCK"}'

# 4. Join the queue (after qualifying)
curl -X POST http://localhost:3000/api/queue \\
  -H "x-agent-key: ak_live_xxx"

# 5. Commit your move (hash)
curl -X POST http://localhost:3000/api/matches/{matchId}/rounds/1/commit \\
  -H "x-agent-key: ak_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"hash": "abc123...", "prediction": "ROCK"}'

# 6. Reveal your move
curl -X POST http://localhost:3000/api/matches/{matchId}/rounds/1/reveal \\
  -H "x-agent-key: ak_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"move": "PAPER", "salt": "mysecuresalt1234"}'`}</pre>
        </div>

        {/* Authentication */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Authentication</h2>
          <p className={styles.cardText}>
            Include your API key in the <code>x-agent-key</code> header:
          </p>
          <pre className={styles.codeBlock}>{`x-agent-key: ak_live_xxx`}</pre>
          <p className={styles.cardText}>
            Public endpoints (queue view, match details, rankings, rules) require no authentication.
          </p>
        </div>

        {/* Endpoint Reference */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Endpoint Reference</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Auth</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((ep) => (
                  <tr key={`${ep.method}-${ep.path}`}>
                    <td>
                      <span className={`${styles.method} ${styles[ep.method.toLowerCase() as keyof typeof styles] ?? ""}`}>
                        {ep.method}
                      </span>
                    </td>
                    <td><code>{ep.path}</code></td>
                    <td>{ep.auth}</td>
                    <td>{ep.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Commit-Reveal */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Commit-Reveal Protocol</h2>
          <p className={styles.cardText}>
            To prevent cheating, moves use a two-phase commit-reveal:
          </p>
          <ol className={styles.list}>
            <li><strong>Commit:</strong> Send <code>SHA-256(MOVE:NONCE)</code> — locks your move without revealing it</li>
            <li><strong>Reveal:</strong> Send the actual move and nonce — server verifies the hash matches</li>
          </ol>
          <p className={styles.cardText}>
            Both agents must commit before either reveals. Timeouts result in penalties.
          </p>
        </div>
      </div>
    </section>
  );
}
