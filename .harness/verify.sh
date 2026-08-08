#!/usr/bin/env bash
# 闭环验证：退出码 0 = 通过。测的是真实 Pi extension 路径（非 mock）。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

cd "$ROOT/pi-agent"

if [[ ! -d node_modules/@earendil-works/pi-coding-agent ]]; then
  echo "[verify] installing pi-agent deps (first run)"
  npm install --ignore-scripts >/tmp/aiia-npm-install.log 2>&1 || { cat /tmp/aiia-npm-install.log; exit 1; }
fi

echo "[verify] unit: policy (safety) + memory store"
node --test test/policy.test.js test/memory-store.test.js

echo "[verify] real-session wiring: load safety+memory into genuine Pi AgentSession"
# ASSERTS: extensions load without error + hooks register in a real session.
# Live tool_call block is exercised when a working model exists, else gracefully skipped.
OUT="$(node test/integration-real-session.mjs 2>/tmp/aiia-integration.log)"
echo "$OUT"
echo "$OUT" | grep -q '^INTEGRATION_OK' || { echo "[verify] real-session wiring FAILED:" >&2; cat /tmp/aiia-integration.log >&2; exit 1; }

echo "[verify] OK"
