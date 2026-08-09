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

echo "[verify] unit: policy (safety) + memory store + vault/sync crypto + secret-gate + web-search-proxy + subagent-worktree + router + task-runner + cron-scheduler + sandbox-policy + quality-gate + trajectory + kb-search + os-browser + channel-adapter + goal + add-dir + reply-prefs + capability-catalog + slash-ux"
node --test test/policy.test.js test/memory-store.test.js test/vault-sync-crypto.test.js test/secret-gate-router.test.js test/web-search-proxy.test.js test/subagent-worktree.test.js test/router.test.js test/task-runner.test.js test/cron-scheduler.test.js test/sandbox-policy.test.js test/quality-gate.test.js test/trajectory.test.js test/kb-search.test.js test/os-browser.test.js test/channel-adapter.test.js test/goal-command.test.js test/add-dir.test.js test/reply-prefs.test.js test/capability-catalog.test.js test/slash-ux.test.js

echo "[verify] link-pi-skills: idempotent symlink into ~/.pi/agent/skills"
bash "$ROOT/scripts/link-pi-skills.test.sh"

echo "[verify] real hook: safety.js loaded by Pi actually BLOCKS dangerous cmd (no model, cannot skip)"
node --test test/safety-hook.test.mjs

echo "[verify] real injection: memory.js loaded by Pi actually INJECTS memories into context (no model)"
node --test test/memory-inject.test.mjs

echo "[verify] e2e real usage: web search proxy & agy bridge end-to-end HTTP/hook dispatch"
node test/e2e-real-usage.mjs

echo "[verify] real-session wiring: load safety+memory into genuine Pi AgentSession"
# ASSERTS: extensions load without error + hooks register in a real session.
# Live tool_call block is exercised when a working model exists, else gracefully skipped.
OUT="$(node test/integration-real-session.mjs 2>/tmp/aiia-integration.log)"
echo "$OUT"
echo "$OUT" | grep -q '^INTEGRATION_OK' || { echo "[verify] real-session wiring FAILED:" >&2; cat /tmp/aiia-integration.log >&2; exit 1; }

echo "[verify] OK"
