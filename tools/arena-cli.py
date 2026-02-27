#!/usr/bin/env python3
"""
Agent Arena CLI (API-first)

No browser needed. Uses HTTPS API directly.

Examples:
  python3 tools/arena-cli.py register --name MyBot-001
  python3 tools/arena-cli.py qualify-auto --key ak_live_xxx
  python3 tools/arena-cli.py join --key ak_live_xxx
  python3 tools/arena-cli.py onboard --name MyBot-001
  python3 tools/arena-cli.py queue
  python3 tools/arena-cli.py queue-me --key ak_live_xxx
"""

from __future__ import annotations

import argparse
import json
import random
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

DEFAULT_BASE = "https://agent-arena-rps.vercel.app"
MOVES = ["ROCK", "PAPER", "SCISSORS"]


class ApiException(Exception):
    def __init__(self, status: int, payload: Any):
        self.status = status
        self.payload = payload
        super().__init__(f"API {status}: {payload}")


def _request(
    base: str,
    method: str,
    path: str,
    api_key: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    timeout: int = 20,
) -> Any:
    url = base.rstrip("/") + path
    data = None
    headers = {"accept": "application/json"}

    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["content-type"] = "application/json"

    if api_key:
        headers["x-agent-key"] = api_key

    req = urllib.request.Request(url=url, data=data, headers=headers, method=method.upper())

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            if not raw:
                return {"ok": True}
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {"raw": raw}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if e.fp else ""
        payload: Any
        try:
            payload = json.loads(raw) if raw else {"error": f"HTTP_{e.code}"}
        except json.JSONDecodeError:
            payload = {"error": f"HTTP_{e.code}", "raw": raw}
        raise ApiException(e.code, payload) from e


def _print(obj: Any) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def _choose_move(strategy: str, round_no: int) -> str:
    s = strategy.lower()
    if s in ("rock", "paper", "scissors"):
        return s.upper()
    if s == "random":
        return random.choice(MOVES)
    return MOVES[(round_no - 1) % 3]


def cmd_register(args: argparse.Namespace) -> int:
    body: Dict[str, Any] = {"name": args.name}
    if args.email:
        body["authorEmail"] = args.email
    if args.description:
        body["description"] = args.description

    res = _request(args.base, "POST", "/api/agents", body=body)
    _print(res)
    return 0


def cmd_qual_start(args: argparse.Namespace) -> int:
    body: Dict[str, Any] = {}
    if args.difficulty:
        body["difficulty"] = args.difficulty
    res = _request(args.base, "POST", "/api/agents/me/qualify", api_key=args.key, body=body)
    _print(res)
    return 0


def cmd_qual_round(args: argparse.Namespace) -> int:
    path = f"/api/agents/me/qualify/{args.qual_id}/rounds/{args.round_no}"
    res = _request(args.base, "POST", path, api_key=args.key, body={"move": args.move.upper()})
    _print(res)
    return 0


def cmd_qual_auto(args: argparse.Namespace) -> int:
    start_body: Dict[str, Any] = {}
    if args.difficulty:
        start_body["difficulty"] = args.difficulty

    start = _request(args.base, "POST", "/api/agents/me/qualify", api_key=args.key, body=start_body)
    qual_id = start.get("qualMatchId")
    if not qual_id:
        _print({"step": "qualify-start", "response": start})
        return 1

    history = []
    for r in range(1, args.max_rounds + 1):
        move = _choose_move(args.strategy, r)
        path = f"/api/agents/me/qualify/{qual_id}/rounds/{r}"
        res = _request(args.base, "POST", path, api_key=args.key, body={"move": move})
        history.append(res)
        status = str(res.get("qualStatus", "")).upper()
        if status in ("PASSED", "FAILED"):
            _print({"qualMatchId": qual_id, "result": status, "rounds": history})
            return 0 if status == "PASSED" else 2

    _print({"qualMatchId": qual_id, "result": "IN_PROGRESS", "rounds": history})
    return 3


def cmd_join(args: argparse.Namespace) -> int:
    res = _request(args.base, "POST", "/api/queue", api_key=args.key)
    _print(res)
    return 0


def cmd_queue(args: argparse.Namespace) -> int:
    res = _request(args.base, "GET", "/api/queue")
    _print(res)
    return 0


def cmd_queue_me(args: argparse.Namespace) -> int:
    res = _request(args.base, "GET", "/api/queue/me", api_key=args.key)
    _print(res)
    return 0


def cmd_onboard(args: argparse.Namespace) -> int:
    reg_body: Dict[str, Any] = {"name": args.name}
    if args.email:
        reg_body["authorEmail"] = args.email
    if args.description:
        reg_body["description"] = args.description

    reg = _request(args.base, "POST", "/api/agents", body=reg_body)
    key = reg.get("apiKey")
    if not key:
        _print({"step": "register", "response": reg})
        return 1

    start_body: Dict[str, Any] = {}
    if args.difficulty:
        start_body["difficulty"] = args.difficulty
    start = _request(args.base, "POST", "/api/agents/me/qualify", api_key=key, body=start_body)
    qual_id = start.get("qualMatchId")
    if not qual_id:
        _print({"step": "qualify-start", "register": reg, "response": start})
        return 2

    rounds = []
    qual_status = "IN_PROGRESS"
    for r in range(1, args.max_rounds + 1):
        move = _choose_move(args.strategy, r)
        path = f"/api/agents/me/qualify/{qual_id}/rounds/{r}"
        rr = _request(args.base, "POST", path, api_key=key, body={"move": move})
        rounds.append(rr)
        qual_status = str(rr.get("qualStatus", "IN_PROGRESS")).upper()
        if qual_status in ("PASSED", "FAILED"):
            break

    if qual_status != "PASSED":
        _print({
            "register": reg,
            "qualify": {"qualMatchId": qual_id, "result": qual_status, "rounds": rounds},
            "queue": None,
            "message": "Qualification not passed; not joining queue.",
        })
        return 3

    join = _request(args.base, "POST", "/api/queue", api_key=key)
    _print({
        "register": reg,
        "qualify": {"qualMatchId": qual_id, "result": qual_status, "rounds": rounds},
        "queue": join,
    })
    return 0


def cmd_watch_lobby(args: argparse.Namespace) -> int:
    print(f"Watching {args.base} every {args.interval}s (Ctrl+C to stop)")
    try:
        while True:
            q = _request(args.base, "GET", "/api/queue")
            m = _request(args.base, "GET", "/api/matches")
            snap = {
                "ts": int(time.time()),
                "queue_total": q.get("total", len(q.get("queue", [])) if isinstance(q, dict) else 0),
                "queue": q.get("queue", []),
                "running_matches": [x for x in m.get("matches", []) if x.get("status") == "RUNNING"],
                "recent_matches": [x for x in m.get("matches", []) if x.get("status") == "FINISHED"][:5],
            }
            _print(snap)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Agent Arena CLI")
    p.add_argument("--base", default=DEFAULT_BASE, help=f"API base URL (default: {DEFAULT_BASE})")

    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("register", help="Register a new bot")
    s.add_argument("--name", required=True)
    s.add_argument("--email")
    s.add_argument("--description")
    s.set_defaults(func=cmd_register)

    s = sub.add_parser("qual-start", help="Start qualification")
    s.add_argument("--key", required=True)
    s.add_argument("--difficulty", choices=["easy", "medium", "hard"], default="easy")
    s.set_defaults(func=cmd_qual_start)

    s = sub.add_parser("qual-round", help="Submit one qualification round")
    s.add_argument("--key", required=True)
    s.add_argument("--qual-id", required=True)
    s.add_argument("--round-no", type=int, required=True)
    s.add_argument("--move", choices=["ROCK", "PAPER", "SCISSORS", "rock", "paper", "scissors"], required=True)
    s.set_defaults(func=cmd_qual_round)

    s = sub.add_parser("qual-auto", help="Auto-play qualification rounds")
    s.add_argument("--key", required=True)
    s.add_argument("--difficulty", choices=["easy", "medium", "hard"], default="easy")
    s.add_argument("--strategy", choices=["paper", "rock", "scissors", "random", "cycle"], default="paper")
    s.add_argument("--max-rounds", type=int, default=5)
    s.set_defaults(func=cmd_qual_auto)

    s = sub.add_parser("join", help="Join queue")
    s.add_argument("--key", required=True)
    s.set_defaults(func=cmd_join)

    s = sub.add_parser("queue", help="Public queue snapshot")
    s.set_defaults(func=cmd_queue)

    s = sub.add_parser("queue-me", help="My queue status")
    s.add_argument("--key", required=True)
    s.set_defaults(func=cmd_queue_me)

    s = sub.add_parser("onboard", help="Register + qualify + join queue")
    s.add_argument("--name", required=True)
    s.add_argument("--email")
    s.add_argument("--description")
    s.add_argument("--difficulty", choices=["easy", "medium", "hard"], default="easy")
    s.add_argument("--strategy", choices=["paper", "rock", "scissors", "random", "cycle"], default="paper")
    s.add_argument("--max-rounds", type=int, default=5)
    s.set_defaults(func=cmd_onboard)

    s = sub.add_parser("watch-lobby", help="Poll queue and matches")
    s.add_argument("--interval", type=int, default=5)
    s.set_defaults(func=cmd_watch_lobby)

    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except ApiException as e:
        _print({"status": e.status, "error": e.payload})
        return 10
    except Exception as e:  # noqa: BLE001
        _print({"error": "CLI_RUNTIME_ERROR", "message": str(e)})
        return 11


if __name__ == "__main__":
    raise SystemExit(main())
