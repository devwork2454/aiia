# deploy/

自研 HTTP 宿主的 systemd unit 已归档：[`legacy/deploy/aiia-host.service`](../legacy/deploy/aiia-host.service)。

当前入口：本机 `pi`（`pi install <repo>/pi-agent`）。后台用 tmux 或 `pi -p` / `pi --mode rpc`，不要再 `ExecStart=node host/src/server.js`。
