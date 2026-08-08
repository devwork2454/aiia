#!/usr/bin/env bash
# 闭环验证：退出码 0 = 通过。每项检查失败立即退出并给出可定位的输出。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
export PYTHONPATH="$ROOT"
export AIIA_MOCK=1

PY=python3
if [[ -x "$ROOT/venv/bin/python" ]]; then
  PY="$ROOT/venv/bin/python"
fi

echo "[verify] python tests (memory + adapter↔host roundtrip)"
"$PY" -m pytest tests/ -x -q

echo "[verify] host safety unit tests"
(cd host && node --test test/*.test.js)

echo "[verify] host mock health"
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
AIIA_MOCK=1 AIIA_HOST_PORT="$PORT" node host/src/server.js >/tmp/aiia-host-verify.log 2>&1 &
HOST_PID=$!
cleanup() { kill "$HOST_PID" 2>/dev/null || true; }
trap cleanup EXIT
ok=0
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:${PORT}/health" | grep -q '"status":"ok"'; then
    ok=1
    break
  fi
  sleep 0.1
done
if [[ "$ok" != "1" ]]; then
  echo "[verify] host failed; log:" >&2
  cat /tmp/aiia-host-verify.log >&2 || true
  exit 1
fi
curl -sf -X POST "http://127.0.0.1:${PORT}/v1/chat" \
  -H 'Content-Type: application/json' \
  -d '{"session_key":"verify","text":"hello","channel":"cli"}' | grep -q '"ok":true'

echo "[verify] schema present"
test -f data/schema.sql

echo "[verify] OK"
