#!/usr/bin/env bash
# 将 AIIA 仓库内需「本机 Pi 默认可用」的 skills 幂等链接到 ~/.pi/agent/skills
# 用法:
#   AIIA_DIR=/path/to/aiia bash scripts/link-pi-skills.sh
#   bash scripts/link-pi-skills.sh          # 默认以本脚本所在仓库为 AIIA_DIR
#   HOME=/tmp/x AIIA_DIR=... bash scripts/link-pi-skills.sh   # 测试用
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AIIA_DIR="${AIIA_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PI_SKILLS_DIR="${PI_SKILLS_DIR:-$HOME/.pi/agent/skills}"

# 需要挂到全局 Pi 的 skill 清单（源：仓库 .agents/skills/<name>）
DEFAULT_PI_SKILLS=(auto-harness goal imp)

link_skill() {
  local name="$1"
  local src="$AIIA_DIR/.agents/skills/$name"
  local dst="$PI_SKILLS_DIR/$name"

  if [[ ! -d "$src" ]]; then
    echo "[link-pi-skills] SKIP missing source: $src" >&2
    return 1
  fi

  mkdir -p "$PI_SKILLS_DIR"

  if [[ -L "$dst" ]]; then
    local cur
    cur="$(readlink "$dst")"
    if [[ "$cur" == "$src" ]]; then
      echo "[link-pi-skills] OK (exists) $dst -> $src"
      return 0
    fi
    ln -sfn "$src" "$dst"
    echo "[link-pi-skills] UPDATED $dst -> $src"
    return 0
  fi

  if [[ -e "$dst" ]]; then
    # Existing non-symlink (e.g. a skill that ships with Pi or the user's own).
    # Default: keep it and don't fail the install. AIIA_LINK_FORCE=1 replaces it.
    if [[ "${AIIA_LINK_FORCE:-}" = "1" ]]; then
      local bak="$dst.bak"
      rm -rf "$bak"
      mv "$dst" "$bak"
      ln -s "$src" "$dst"
      echo "[link-pi-skills] REPLACED $dst -> $src (old kept at $bak)" >&2
      return 0
    fi
    echo "[link-pi-skills] CONFLICT: $dst exists and is not a symlink; keeping existing. Set AIIA_LINK_FORCE=1 to replace." >&2
    return 0
  fi

  ln -s "$src" "$dst"
  echo "[link-pi-skills] LINKED $dst -> $src"
  return 0
}

main() {
  local skills=("${DEFAULT_PI_SKILLS[@]}")
  if [[ $# -gt 0 ]]; then
    skills=("$@")
  fi

  local failed=0
  local name
  for name in "${skills[@]}"; do
    if ! link_skill "$name"; then
      failed=1
    fi
  done

  if [[ "$failed" -ne 0 ]]; then
    echo "[link-pi-skills] FAILED" >&2
    exit 1
  fi
  echo "[link-pi-skills] DONE"
}

main "$@"
