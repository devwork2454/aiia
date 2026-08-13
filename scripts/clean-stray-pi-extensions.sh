#!/usr/bin/env bash
# Remove leftover AIIA extension symlinks in ~/.pi/agent/extensions.
# Those resolve ../src against ~/.pi/agent/src and crash `pi` startup.
set -euo pipefail

AIIA_DIR="${AIIA_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
EXT_SRC="$AIIA_DIR/pi-agent/extensions"
DEST="${PI_USER_EXTENSIONS:-$HOME/.pi/agent/extensions}"

if [[ ! -d "$DEST" || ! -d "$EXT_SRC" ]]; then
  exit 0
fi

src_real="$(cd "$EXT_SRC" && pwd -P)"
removed=0
shopt -s nullglob
for path in "$DEST"/*; do
  [[ -L "$path" ]] || continue
  target="$(readlink -f "$path" || true)"
  [[ -n "$target" ]] || continue
  case "$target" in
    "$src_real"/*)
      rm -f "$path"
      echo "[clean-stray-pi-extensions] removed $path -> $target"
      removed=$((removed + 1))
      ;;
  esac
done

if [[ "$removed" -eq 0 ]]; then
  echo "[clean-stray-pi-extensions] OK (no stray AIIA extension symlinks)"
else
  echo "[clean-stray-pi-extensions] removed $removed stray symlink(s)"
fi
