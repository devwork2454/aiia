#!/usr/bin/env bash
# AIIA host 后台运行管理：start / stop / status / restart / logs / attach
# 无 systemd 也能用（nohup + PID 文件）；有 systemd 时优先见 deploy/aiia-host.service。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST_ENTRY="$ROOT/host/src/server.js"

RUN_DIR="${AIIA_RUN_DIR:-$ROOT/.run}"
PID_FILE="$RUN_DIR/aiia-host.pid"
LOG_FILE="${AIIA_LOG_FILE:-$RUN_DIR/aiia-host.log}"
PORT="${AIIA_HOST_PORT:-8787}"

mkdir -p "$RUN_DIR"

_is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

_pid() { cat "$PID_FILE" 2>/dev/null || true; }

cmd_start() {
  if _is_running; then
    echo "aiia-host already running (pid $(_pid), port $PORT)"
    return 0
  fi
  # 后台脱离当前终端：关掉终端也继续跑
  AIIA_HOST_PORT="$PORT" nohup node "$HOST_ENTRY" >>"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" >"$PID_FILE"
  disown "$pid" 2>/dev/null || true

  # 等待健康
  for _ in $(seq 1 50); do
    if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      echo "aiia-host started (pid $pid, port $PORT), log: $LOG_FILE"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "aiia-host exited early; log tail:" >&2
      tail -n 20 "$LOG_FILE" >&2 || true
      rm -f "$PID_FILE"
      return 1
    fi
    sleep 0.1
  done
  echo "aiia-host did not become healthy in time; log tail:" >&2
  tail -n 20 "$LOG_FILE" >&2 || true
  return 1
}

cmd_stop() {
  if ! _is_running; then
    echo "aiia-host not running"
    rm -f "$PID_FILE"
    return 0
  fi
  local pid
  pid="$(_pid)"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || { rm -f "$PID_FILE"; echo "aiia-host stopped (pid $pid)"; return 0; }
    sleep 0.1
  done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "aiia-host force-stopped (pid $pid)"
}

cmd_status() {
  if _is_running; then
    local pid; pid="$(_pid)"
    local health
    health="$(curl -sf "http://127.0.0.1:${PORT}/health" 2>/dev/null || echo '{"status":"unreachable"}')"
    echo "running  pid=$pid port=$PORT health=$health"
    return 0
  fi
  echo "stopped  port=$PORT"
  return 3
}

cmd_logs() { touch "$LOG_FILE"; tail -n "${2:-50}" -f "$LOG_FILE"; }

cmd_attach() {
  # “重新连上”后台会话：这里给出 tail -f 视图；真正的多会话续接由宿主按 session_key 提供。
  echo "attaching to aiia-host logs (Ctrl-C to detach; host keeps running)"
  touch "$LOG_FILE"
  tail -n 50 -f "$LOG_FILE"
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status)  cmd_status ;;
  logs)    cmd_logs "$@" ;;
  attach)  cmd_attach ;;
  *)
    echo "usage: $0 {start|stop|restart|status|logs [N]|attach}" >&2
    exit 2
    ;;
esac
