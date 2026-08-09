#!/usr/bin/env bash
# 验证 link-pi-skills.sh：临时 HOME 下幂等链接 + 冲突检测
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/link-pi-skills.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP"
export AIIA_DIR="$ROOT"

# 1) 首次链接
bash "$SCRIPT" auto-harness
link="$HOME/.pi/agent/skills/auto-harness"
[[ -L "$link" ]] || { echo "FAIL: not a symlink"; exit 1; }
[[ "$(readlink "$link")" == "$ROOT/.agents/skills/auto-harness" ]] || {
  echo "FAIL: wrong target $(readlink "$link")"
  exit 1
}

# 2) 幂等
bash "$SCRIPT" auto-harness

# 3) 更新错误指向
ln -sfn /nonexistent "$link"
bash "$SCRIPT" auto-harness
[[ "$(readlink "$link")" == "$ROOT/.agents/skills/auto-harness" ]] || {
  echo "FAIL: did not repair symlink"
  exit 1
}

# 4) 非 symlink 冲突应失败
rm -f "$link"
mkdir -p "$link"
if bash "$SCRIPT" auto-harness 2>/dev/null; then
  echo "FAIL: expected conflict failure"
  exit 1
fi

echo "link-pi-skills.test.sh OK"
