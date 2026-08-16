#!/usr/bin/env bash
# Deterministic quality checks for AIIA (Biome + Ruff + ast-grep + node syntax).
# Exit 0 = pass. Designed for local runs, pre-commit, and .harness/verify.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PI="$ROOT/pi-agent"
BIOME="$PI/node_modules/.bin/biome"
SG="$PI/node_modules/.bin/ast-grep"
# Prefer package bin over system `sg` (often Linux setgid group tool)
if [[ ! -x "$SG" ]]; then
  SG="$PI/node_modules/.bin/sg"
fi

fail=0

echo "[quality] biome lint (error-level) — pi-agent"
if [[ -x "$BIOME" ]]; then
  if ! (cd "$PI" && "$BIOME" lint --diagnostic-level=error --colors=off src extensions test); then
    echo "[quality] biome FAILED" >&2
    fail=1
  fi
else
  echo "[quality] biome binary missing — run: cd pi-agent && npm install" >&2
  fail=1
fi

echo "[quality] ruff check — legacy Python hard rules (F/B, no E501)"
if command -v ruff >/dev/null 2>&1; then
  if [[ -d "$ROOT/legacy" ]]; then
    if ! ruff check "$ROOT/legacy" --select F,B --quiet; then
      echo "[quality] ruff F/B FAILED" >&2
      fail=1
    fi
  fi
else
  echo "[quality] ruff not on PATH — skip Python lint"
fi

echo "[quality] ast-grep architecture rules"
if [[ -x "$SG" ]]; then
  if ! (cd "$ROOT" && "$SG" scan --config sgconfig.yml); then
    echo "[quality] ast-grep FAILED" >&2
    fail=1
  fi
else
  echo "[quality] ast-grep missing — run: cd pi-agent && npm install" >&2
  fail=1
fi

echo "[quality] agent tool analytics probe"
if [[ -x "$ROOT/scripts/tool_analytics.py" ]]; then
  "$ROOT/scripts/tool_analytics.py" || true
else
  echo "[quality] tool_analytics.py not found or not executable"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "[quality] FAILED"
  exit 1
fi
echo "[quality] OK"
exit 0
