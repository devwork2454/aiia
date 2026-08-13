#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/clean-stray-pi-extensions.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP"
export AIIA_DIR="$ROOT"
mkdir -p "$HOME/.pi/agent/extensions"

keep="$HOME/.pi/agent/extensions/charon.ts"
printf 'export default function() {}\n' >"$keep"
stray="$HOME/.pi/agent/extensions/remote-config.js"
ln -s "$ROOT/pi-agent/extensions/remote-config.js" "$stray"
other="$HOME/.pi/agent/extensions/outside.js"
ln -s /tmp/not-aiia-ext.js "$other"

bash "$SCRIPT"

[[ -f "$keep" ]] || { echo "FAIL: kept user file was deleted"; exit 1; }
[[ ! -e "$stray" ]] || { echo "FAIL: stray AIIA symlink remains"; exit 1; }
[[ -L "$other" ]] || { echo "FAIL: unrelated symlink was removed"; exit 1; }

bash "$SCRIPT" >/tmp/clean-stray-second.out
grep -q "no stray" /tmp/clean-stray-second.out || {
  echo "FAIL: second run should be a no-op"
  cat /tmp/clean-stray-second.out
  exit 1
}

echo "clean-stray-pi-extensions.test.sh OK"
