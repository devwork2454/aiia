#!/usr/bin/env bash
# 验证 link-pi-skills.sh：临时 HOME 下幂等链接 + 冲突检测
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/link-pi-skills.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP"
export AIIA_DIR="$ROOT"

# 1) 首次链接默认清单（含 auto-harness + goal）
bash "$SCRIPT"
link="$HOME/.pi/agent/skills/auto-harness"
goal_link="$HOME/.pi/agent/skills/goal"
[[ -L "$link" ]] || { echo "FAIL: not a symlink"; exit 1; }
[[ -L "$goal_link" ]] || { echo "FAIL: goal skill not linked"; exit 1; }
[[ "$(readlink "$link")" == "$ROOT/.agents/skills/auto-harness" ]] || {
  echo "FAIL: wrong target $(readlink "$link")"
  exit 1
}
[[ "$(readlink "$goal_link")" == "$ROOT/.agents/skills/goal" ]] || {
  echo "FAIL: wrong goal target $(readlink "$goal_link")"
  exit 1
}
[[ -f "$ROOT/.agents/skills/goal/SKILL.md" ]] || {
  echo "FAIL: missing goal SKILL.md"
  exit 1
}

# 2) 幂等
bash "$SCRIPT"

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
