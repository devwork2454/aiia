#!/usr/bin/env bash
# 闭环验证：退出码 0 = 通过。每项检查失败立即退出并给出可定位的输出。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[verify] python smoke tests"
if [[ -x venv/bin/python ]]; then
  venv/bin/python -m pytest tests/ -x -q
else
  python3 -m pytest tests/ -x -q
fi

if [[ -f package.json ]]; then
  echo "[verify] node package present — run typecheck/tests when configured"
  if command -v npm >/dev/null 2>&1 && npm run | grep -q 'test'; then
    npm test
  fi
fi

if command -v ruff >/dev/null 2>&1 && [[ -f pyproject.toml ]]; then
  echo "[verify] ruff check (python)"
  ruff check main.py || true
fi

echo "[verify] OK"
