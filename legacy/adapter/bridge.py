"""HTTP bridge from channel adapter to AIIA Pi host."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass


@dataclass
class HostReply:
    ok: bool
    text: str
    session_key: str
    mock: bool = False


def host_base_url() -> str:
    return os.getenv("AIIA_HOST_URL", "http://127.0.0.1:8787").rstrip("/")


def normalize_inbound(
    *,
    session_key: str,
    text: str,
    reply_to: str | None = None,
    channel: str = "feishu",
) -> dict:
    return {
        "session_key": session_key,
        "text": text,
        "reply_to": reply_to,
        "channel": channel,
    }


def post_chat(payload: dict, timeout: float = 120.0) -> HostReply:
    url = f"{host_base_url()}/v1/chat"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        return HostReply(ok=False, text=f"host unreachable: {exc}", session_key=payload.get("session_key", ""))
    return HostReply(
        ok=bool(body.get("ok", False)),
        text=str(body.get("text", "")),
        session_key=str(body.get("session_key", payload.get("session_key", ""))),
        mock=bool(body.get("mock", False)),
    )
