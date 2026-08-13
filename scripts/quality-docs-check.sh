#!/usr/bin/env bash
# Docs consistency hook: Generates docs from code and checks for drift.
# Exit 0 = pass. Designed for local runs and .harness/verify.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[docs-check] Generating API docs from Pi extensions..."
node "$ROOT/scripts/generate-api-docs.mjs"

if ! git diff --exit-code "$ROOT/docs/EXTENSIONS.md" >/dev/null 2>&1; then
  echo "[docs-check] ERROR: Documentation drift detected!" >&2
  echo "[docs-check] The code modifications are not reflected in docs/EXTENSIONS.md." >&2
  echo "[docs-check] AIIA Policy: Code changes MUST be accompanied by documentation updates." >&2
  echo "[docs-check] Showing diff:" >&2
  git diff "$ROOT/docs/EXTENSIONS.md" >&2
  echo "[docs-check] Please commit the updated docs/EXTENSIONS.md to fix this." >&2
  exit 1
fi

echo "[docs-check] live docs must not claim archived HTTP host as current"
stale="$(grep -nE 'host/src/server\.js|adapter/memory\.py' "$ROOT/ARCHITECTURE.md" "$ROOT/SPEC.md" | grep -viE 'legacy|归档|archived' || true)"
if [[ -n "$stale" ]]; then
  echo "[docs-check] ERROR: live docs still present archived host/memory as current:" >&2
  echo "$stale" >&2
  exit 1
fi
if [[ -f "$ROOT/deploy/aiia-host.service" ]]; then
  echo "[docs-check] ERROR: deploy/aiia-host.service must live under legacy/" >&2
  exit 1
fi

echo "[docs-check] OK: Documentation is perfectly synced with code."
exit 0
