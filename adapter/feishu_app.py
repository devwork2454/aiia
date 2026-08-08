"""Feishu webhook channel adapter → AIIA host."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from adapter.bridge import normalize_inbound, post_chat
from adapter.memory import append_message, connect, init_db

load_dotenv()
logger = logging.getLogger("aiia.adapter")

APP_ID = os.getenv("FEISHU_APP_ID", "")
APP_SECRET = os.getenv("FEISHU_APP_SECRET", "")
VERIFICATION_TOKEN = os.getenv("FEISHU_VERIFICATION_TOKEN", "")
ENCRYPT_KEY = os.getenv("FEISHU_ENCRYPT_KEY", "")

app = FastAPI(title="AIIA Feishu Adapter")
init_db()


def _extract_text(message: dict[str, Any]) -> str:
    content = message.get("content") or ""
    if isinstance(content, dict):
        return str(content.get("text") or content.get("content") or "")
    if isinstance(content, str):
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                return str(parsed.get("text") or "")
        except json.JSONDecodeError:
            return content
    return str(content)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "aiia-feishu-adapter"}


@app.post("/webhook/event")
async def feishu_event_webhook(request: Request) -> JSONResponse:
    """
    飞书事件入口。

    - URL 验证：直接回 challenge
    - 文本消息：归一化后投递 AIIA host（同步简化版；生产可改队列）
    """
    body = await request.json()

    if "challenge" in body:
        return JSONResponse({"challenge": body["challenge"]})

    # 兼容未装 lark SDK 时的最小化解析；有完整凭证时仍可用旧 main.py 路径
    header = body.get("header") or {}
    event = body.get("event") or {}
    if header.get("event_type") == "im.message.receive_v1" or event.get("message"):
        message = event.get("message") or {}
        sender = event.get("sender") or {}
        chat_id = message.get("chat_id") or "unknown"
        open_id = (sender.get("sender_id") or {}).get("open_id") or "anon"
        session_key = f"feishu:{chat_id}:{open_id}"
        text = _extract_text(message).strip()
        if not text:
            return JSONResponse({"ok": True, "skipped": "empty"})

        with connect() as conn:
            append_message(conn, session_key, "user", text)
            conn.commit()

        payload = normalize_inbound(
            session_key=session_key,
            text=text,
            reply_to=message.get("message_id"),
            channel="feishu",
        )
        reply = post_chat(payload)

        with connect() as conn:
            append_message(conn, session_key, "assistant", reply.text)
            conn.commit()

        # 出站回写飞书留给下一阶段（需 tenant_access_token）；此处先记录
        logger.info("host reply ok=%s mock=%s len=%s", reply.ok, reply.mock, len(reply.text))
        return JSONResponse(
            {
                "ok": reply.ok,
                "session_key": reply.session_key,
                "reply_preview": reply.text[:200],
                "mock": reply.mock,
            }
        )

    return JSONResponse({"ok": True, "ignored": True})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("adapter.feishu_app:app", host="0.0.0.0", port=8000, reload=True)
