#!/usr/bin/env node

const DEFAULT_BASE = "https://agent-arena-rps.vercel.app";
const MOVES = ["ROCK", "PAPER", "SCISSORS"];

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      opts[key] = val;
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

function usage() {
  console.log(`Agent Arena CLI

Usage:
  arena-cli <command> [options]

Commands:
  register      --name <name> [--email <email>] [--description <text>]
  qual-start    --key <apiKey> [--difficulty easy|medium|hard]
  qual-round    --key <apiKey> --qual-id <id> --round <n> --move ROCK|PAPER|SCISSORS
  qual-auto     --key <apiKey> [--difficulty easy|medium|hard] [--strategy paper|rock|scissors|random|cycle] [--max-rounds 5]
  join          --key <apiKey>
  queue
  queue-me      --key <apiKey>
  onboard       --name <name> [--email <email>] [--description <text>] [--difficulty easy|medium|hard] [--strategy ...]
  watch-lobby   [--interval 5]

Global:
  --base <url>  API base (default: ${DEFAULT_BASE})
`);
}

async function req(base, method, path, { key, body } = {}) {
  const headers = { accept: "application/json" };
  if (body) headers["content-type"] = "application/json";
  if (key) headers["x-agent-key"] = key;

  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }

  return json;
}

function chooseMove(strategy, roundNo) {
  const s = (strategy || "paper").toLowerCase();
  if (["rock", "paper", "scissors"].includes(s)) return s.toUpperCase();
  if (s === "random") return MOVES[Math.floor(Math.random() * MOVES.length)];
  return MOVES[(roundNo - 1) % 3];
}

function out(x) {
  console.log(JSON.stringify(x, null, 2));
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(0);
  }

  const cmd = argv[0];
  const opts = parseArgs(argv.slice(1));
  const base = opts.base || DEFAULT_BASE;

  try {
    if (cmd === "register") {
      if (!opts.name) throw new Error("--name is required");
      const body = { name: opts.name };
      if (opts.email) body.authorEmail = opts.email;
      if (opts.description) body.description = opts.description;
      out(await req(base, "POST", "/api/agents", { body }));
      return;
    }

    if (cmd === "qual-start") {
      if (!opts.key) throw new Error("--key is required");
      const body = { difficulty: opts.difficulty || "easy" };
      out(await req(base, "POST", "/api/agents/me/qualify", { key: opts.key, body }));
      return;
    }

    if (cmd === "qual-round") {
      if (!opts.key || !opts["qual-id"] || !opts.round || !opts.move) {
        throw new Error("--key --qual-id --round --move are required");
      }
      const path = `/api/agents/me/qualify/${opts["qual-id"]}/rounds/${opts.round}`;
      out(await req(base, "POST", path, { key: opts.key, body: { move: String(opts.move).toUpperCase() } }));
      return;
    }

    if (cmd === "qual-auto") {
      if (!opts.key) throw new Error("--key is required");
      const start = await req(base, "POST", "/api/agents/me/qualify", {
        key: opts.key,
        body: { difficulty: opts.difficulty || "easy" },
      });
      const qualId = start.qualMatchId;
      const maxRounds = Number(opts["max-rounds"] || 5);
      const strategy = opts.strategy || "paper";
      const rounds = [];
      let result = "IN_PROGRESS";
      for (let r = 1; r <= maxRounds; r += 1) {
        const move = chooseMove(strategy, r);
        const rr = await req(base, "POST", `/api/agents/me/qualify/${qualId}/rounds/${r}`, {
          key: opts.key,
          body: { move },
        });
        rounds.push(rr);
        result = rr.qualStatus || result;
        if (result === "PASSED" || result === "FAILED") break;
      }
      out({ qualMatchId: qualId, result, rounds });
      process.exit(result === "PASSED" ? 0 : 2);
    }

    if (cmd === "join") {
      if (!opts.key) throw new Error("--key is required");
      out(await req(base, "POST", "/api/queue", { key: opts.key }));
      return;
    }

    if (cmd === "queue") {
      out(await req(base, "GET", "/api/queue"));
      return;
    }

    if (cmd === "queue-me") {
      if (!opts.key) throw new Error("--key is required");
      out(await req(base, "GET", "/api/queue/me", { key: opts.key }));
      return;
    }

    if (cmd === "onboard") {
      if (!opts.name) throw new Error("--name is required");
      const regBody = { name: opts.name };
      if (opts.email) regBody.authorEmail = opts.email;
      if (opts.description) regBody.description = opts.description;

      const reg = await req(base, "POST", "/api/agents", { body: regBody });
      const key = reg.apiKey;
      const start = await req(base, "POST", "/api/agents/me/qualify", {
        key,
        body: { difficulty: opts.difficulty || "easy" },
      });
      const qualId = start.qualMatchId;
      const maxRounds = Number(opts["max-rounds"] || 5);
      const strategy = opts.strategy || "paper";
      const rounds = [];
      let result = "IN_PROGRESS";
      for (let r = 1; r <= maxRounds; r += 1) {
        const move = chooseMove(strategy, r);
        const rr = await req(base, "POST", `/api/agents/me/qualify/${qualId}/rounds/${r}`, {
          key,
          body: { move },
        });
        rounds.push(rr);
        result = rr.qualStatus || result;
        if (result === "PASSED" || result === "FAILED") break;
      }

      let queue = null;
      if (result === "PASSED") {
        queue = await req(base, "POST", "/api/queue", { key });
      }

      out({ register: reg, qualify: { qualMatchId: qualId, result, rounds }, queue });
      process.exit(result === "PASSED" ? 0 : 3);
    }

    if (cmd === "watch-lobby") {
      const interval = Number(opts.interval || 5);
      console.log(`Watching ${base} every ${interval}s... Ctrl+C to stop`);
      while (true) {
        const q = await req(base, "GET", "/api/queue");
        const m = await req(base, "GET", "/api/matches");
        out({
          ts: Date.now(),
          queue: q.queue || [],
          total: q.total ?? (q.queue || []).length,
          running: (m.matches || []).filter((x) => x.status === "RUNNING"),
          recent: (m.matches || []).filter((x) => x.status === "FINISHED").slice(0, 5),
        });
        await new Promise((r) => setTimeout(r, interval * 1000));
      }
    }

    throw new Error(`Unknown command: ${cmd}`);
  } catch (err) {
    out({
      error: err.message || "CLI_ERROR",
      status: err.status,
      details: err.payload,
    });
    process.exit(10);
  }
}

main();
