#!/usr/bin/env bash
# 消除 Pi 启动的 [Skill conflicts] 警告:user 级与 project 级同名 skill。
#
# 背景:Pi 按 AGENTS 规范从 user 级(~/.agents/skills)与 project 级({cwd}/.agents/skills)
# 同时发现 skills,同名时 project 优先、user 被跳过并打印警告(仅提示,不阻断启动)。
# 关键:指向**同一真实文件**的软链会被 Pi 静默去重(realPathSet),不产生冲突。
#
# 本脚本把「内容相同」的重名 skill 软链化为单一真源,警告即消失、功能保留(可逆,原目录备份 .bak);
# 「内容不同」则提示跳过,绝不自动改(避免破坏用户定制的 skill)。
#
# 用法:
#   bash scripts/fix-skill-conflicts.sh                    # 默认 project-dir=当前目录, keep=project
#   bash scripts/fix-skill-conflicts.sh --dry-run          # 只预览不执行
#   bash scripts/fix-skill-conflicts.sh --project-dir=~/chat
#   bash scripts/fix-skill-conflicts.sh --keep=user        # 保留 user 级为真源(反向软链化)
# 环境变量也可:PROJECT_DIR / USER_SKILLS_DIR / KEEP
set -euo pipefail

KEEP="${KEEP:-project}"            # 保留哪个为真源:user | project
PROJECT_DIR="${PROJECT_DIR:-}"
USER_SKILLS_DIR="${USER_SKILLS_DIR:-}"
DRY_RUN=0

usage() {
  echo "用法: $0 [--dry-run] [--keep=user|project] [--project-dir=PATH] [--user-skills-dir=PATH]"
  echo "  默认: --project-dir=当前目录  --user-skills-dir=~/.agents/skills  --keep=project"
  echo "  --keep=user 时反过来:project 级软链指向 user 级(不改动项目仓库)"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --keep=*) KEEP="${1#*=}"; shift ;;
    --project-dir=*) PROJECT_DIR="${1#*=}"; shift ;;
    --user-skills-dir=*) USER_SKILLS_DIR="${1#*=}"; shift ;;
    -h|--help) usage ;;
    *) echo "未知参数: $1" >&2; usage ;;
  esac
done

[[ "$KEEP" = "user" || "$KEEP" = "project" ]] || { echo "[fix-skill-conflicts] 错误: --keep 只能是 user|project" >&2; exit 1; }

PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
USER_SKILLS_DIR="${USER_SKILLS_DIR:-$HOME/.agents/skills}"
PROJECT_SKILLS_DIR="$PROJECT_DIR/.agents/skills"

if [[ ! -d "$USER_SKILLS_DIR" || ! -d "$PROJECT_SKILLS_DIR" ]]; then
  echo "[fix-skill-conflicts] OK (无冲突扫描源: user=$([ -d "$USER_SKILLS_DIR" ] && echo 存在 || echo 缺失) project=$([ -d "$PROJECT_SKILLS_DIR" ] && echo 存在 || echo 缺失))"
  exit 0
fi

fixed=0
skipped=0
shopt -s nullglob
for user_dir in "$USER_SKILLS_DIR"/*; do
  [[ -d "$user_dir" || -L "$user_dir" ]] || continue
  name="$(basename "$user_dir")"
  [[ "$name" == *.bak ]] && continue                       # 跳过上次的备份
  project_dir="$PROJECT_SKILLS_DIR/$name"
  [[ -e "$project_dir" || -L "$project_dir" ]] || continue # project 侧无同名 → 不冲突

  user_real="$(readlink -f "$user_dir" 2>/dev/null || true)"
  proj_real="$(readlink -f "$project_dir" 2>/dev/null || true)"

  if [[ -n "$user_real" && -n "$proj_real" && "$user_real" = "$proj_real" ]]; then
    echo "[fix-skill-conflicts] OK $name (已是同一真源 $user_real)"
    continue
  fi

  if [[ -n "$user_real" && -n "$proj_real" ]] && diff -rq "$user_real" "$proj_real" >/dev/null 2>&1; then
    # 内容相同 → 软链化为单一真源
    if [[ "$KEEP" = "user" ]]; then
      src="$user_real"; dst="$project_dir"
    else
      src="$proj_real"; dst="$user_dir"
    fi
    bak="${dst}.bak"

    if [[ -L "$dst" ]] && [[ "$(readlink -f "$dst" 2>/dev/null || true)" = "$src" ]]; then
      echo "[fix-skill-conflicts] OK $name (已软链 $dst -> $src)"
      continue
    fi
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[fix-skill-conflicts] DRY-RUN 将软链化 $dst -> $src (原目录备份 $bak)"
      continue
    fi
    rm -rf "$bak"; mv "$dst" "$bak"
    ln -s "$src" "$dst"
    echo "[fix-skill-conflicts] 修复 $name: $dst -> $src (原目录备份 $bak)"
    fixed=$((fixed+1))
  else
    echo "[fix-skill-conflicts] 跳过 $name: user 与 project 内容不同,请手动保留一份 ($USER_SKILLS_DIR/$name vs $PROJECT_SKILLS_DIR/$name)" >&2
    skipped=$((skipped+1))
  fi
done

echo "[fix-skill-conflicts] DONE fixed=$fixed skipped=$skipped"
