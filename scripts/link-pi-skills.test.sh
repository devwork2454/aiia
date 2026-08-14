#!/usr/bin/env bash
# 验证 link-pi-skills.sh：临时 HOME 下幂等链接 + 冲突检测
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/link-pi-skills.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP"
export AIIA_DIR="$ROOT"

# 1) 首次链接默认清单（含 auto-harness + goal + imp）
bash "$SCRIPT"
link="$HOME/.pi/agent/skills/auto-harness"
goal_link="$HOME/.pi/agent/skills/goal"
imp_link="$HOME/.pi/agent/skills/imp"
[[ -L "$link" ]] || { echo "FAIL: not a symlink"; exit 1; }
[[ -L "$goal_link" ]] || { echo "FAIL: goal skill not linked"; exit 1; }
[[ -L "$imp_link" ]] || { echo "FAIL: imp skill not linked"; exit 1; }
[[ "$(readlink "$link")" == "$ROOT/.agents/skills/auto-harness" ]] || {
  echo "FAIL: wrong target $(readlink "$link")"
  exit 1
}
[[ "$(readlink "$goal_link")" == "$ROOT/.agents/skills/goal" ]] || {
  echo "FAIL: wrong goal target $(readlink "$goal_link")"
  exit 1
}
[[ "$(readlink "$imp_link")" == "$ROOT/.agents/skills/imp" ]] || {
  echo "FAIL: wrong imp target $(readlink "$imp_link")"
  exit 1
}
[[ -f "$ROOT/.agents/skills/goal/SKILL.md" ]] || {
  echo "FAIL: missing goal SKILL.md"
  exit 1
}
[[ -f "$ROOT/.agents/skills/imp/SKILL.md" ]] || {
  echo "FAIL: missing imp SKILL.md"
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

# 4) 非 symlink 冲突:默认保留已有目录,不失败(安装不因单个 skill 冲突中断)
rm -f "$link"
mkdir -p "$link"
echo "user content" > "$link/keep.txt"
bash "$SCRIPT" auto-harness || { echo "FAIL: conflict should not fail the script"; exit 1; }
[[ -d "$link" && ! -L "$link" ]] || { echo "FAIL: conflict should keep existing dir"; exit 1; }
[[ -f "$link/keep.txt" ]] || { echo "FAIL: conflict should preserve existing files"; exit 1; }

# 5) AIIA_LINK_FORCE=1:备份旧目录并链接
rm -rf "$link" "$HOME/.pi/agent/skills/auto-harness.bak"
mkdir -p "$link"
echo "old" > "$link/old.txt"
AIIA_LINK_FORCE=1 bash "$SCRIPT" auto-harness
[[ -L "$link" ]] || { echo "FAIL: force should link"; exit 1; }
[[ -d "$HOME/.pi/agent/skills/auto-harness.bak" ]] || { echo "FAIL: force should keep a backup"; exit 1; }
[[ "$(readlink "$link")" == "$ROOT/.agents/skills/auto-harness" ]] || {
  echo "FAIL: force wrong target $(readlink "$link")"
  exit 1
}

echo "link-pi-skills.test.sh OK"
