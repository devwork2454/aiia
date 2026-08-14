#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/fix-skill-conflicts.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HOME="$TMP/home" PROJECT="$TMP/proj"
USER_SKILLS="$HOME/.agents/skills"
PROJECT_SKILLS="$PROJECT/.agents/skills"
mkdir -p "$USER_SKILLS/langfuse" "$PROJECT_SKILLS/langfuse"
printf '# langfuse\n\ntrace/observe LLM calls\n' > "$USER_SKILLS/langfuse/SKILL.md"
printf '# langfuse\n\ntrace/observe LLM calls\n' > "$PROJECT_SKILLS/langfuse/SKILL.md"

# 1) 默认 keep=project:user 级软链化指向 project,原目录备份 .bak,project 真源保留
HOME="$HOME" bash "$SCRIPT" --project-dir="$PROJECT" --user-skills-dir="$USER_SKILLS"
[[ -L "$USER_SKILLS/langfuse" ]] || { echo "FAIL: user langfuse 应变为软链"; exit 1; }
[[ -d "$USER_SKILLS/langfuse.bak" ]] || { echo "FAIL: 应备份原 user langfuse"; exit 1; }
[[ -d "$PROJECT_SKILLS/langfuse" ]] || { echo "FAIL: project 真源应保留"; exit 1; }
[[ "$(readlink -f "$USER_SKILLS/langfuse")" = "$PROJECT_SKILLS/langfuse" ]] || { echo "FAIL: 软链目标应为 project 真源"; exit 1; }

# 2) 幂等:二次运行 no-op(已同一真源)
OUT="$(HOME="$HOME" bash "$SCRIPT" --project-dir="$PROJECT" --user-skills-dir="$USER_SKILLS")"
grep -q "已是同一真源" <<< "$OUT" || { echo "FAIL: 二次运行应幂等\n$OUT"; exit 1; }

# 3) 内容不同 → 跳过,不自动改
mkdir -p "$USER_SKILLS/other" "$PROJECT_SKILLS/other"
printf 'AAA' > "$USER_SKILLS/other/SKILL.md"
printf 'BBB' > "$PROJECT_SKILLS/other/SKILL.md"
HOME="$HOME" bash "$SCRIPT" --project-dir="$PROJECT" --user-skills-dir="$USER_SKILLS" 2>/dev/null || true
[[ -d "$USER_SKILLS/other" && ! -L "$USER_SKILLS/other" ]] || { echo "FAIL: 内容不同不应软链化"; exit 1; }

# 4) --dry-run 不修改(新建一对相同 skill)
mkdir -p "$USER_SKILLS/dry" "$PROJECT_SKILLS/dry"
printf 'same' > "$USER_SKILLS/dry/SKILL.md"
printf 'same' > "$PROJECT_SKILLS/dry/SKILL.md"
OUT="$(HOME="$HOME" bash "$SCRIPT" --dry-run --project-dir="$PROJECT" --user-skills-dir="$USER_SKILLS")"
grep -q "DRY-RUN 将软链化" <<< "$OUT" || { echo "FAIL: dry-run 应提示将软链化\n$OUT"; exit 1; }
[[ -d "$USER_SKILLS/dry" && ! -L "$USER_SKILLS/dry" ]] || { echo "FAIL: dry-run 不应产生修改"; exit 1; }

# 5) --keep=user:反向——project 级软链指向 user,备份在 project 侧
rm -rf "$USER_SKILLS/langfuse" "$USER_SKILLS/langfuse.bak"
mkdir -p "$USER_SKILLS/langfuse"
printf '# langfuse\n\ntrace/observe LLM calls\n' > "$USER_SKILLS/langfuse/SKILL.md"
HOME="$HOME" bash "$SCRIPT" --keep=user --project-dir="$PROJECT" --user-skills-dir="$USER_SKILLS"
[[ -L "$PROJECT_SKILLS/langfuse" ]] || { echo "FAIL: keep=user 时 project langfuse 应变软链"; exit 1; }
[[ -d "$PROJECT_SKILLS/langfuse.bak" ]] || { echo "FAIL: keep=user 时 project 原目录应备份"; exit 1; }
[[ -d "$USER_SKILLS/langfuse" && ! -L "$USER_SKILLS/langfuse" ]] || { echo "FAIL: keep=user 时 user 应保留为真源"; exit 1; }

# 6) 目录缺失 → 无冲突退出 0
mkdir -p "$TMP/empty"
HOME="$TMP/home2" bash "$SCRIPT" --project-dir="$TMP/empty" --user-skills-dir="$TMP/none" >/dev/null || { echo "FAIL: 无冲突应退出 0"; exit 1; }

echo "fix-skill-conflicts.test.sh OK"
