"""adapter → mock host roundtrip."""

from __future__ import annotations

import os
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest

from adapter.bridge import normalize_inbound, post_chat

ROOT = Path(__file__).resolve().parents[1]
HOST_DIR = ROOT / "host"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture(scope="module")
def mock_host():
    port = _free_port()
    env = os.environ.copy()
    env["AIIA_MOCK"] = "1"
    env["AIIA_HOST_PORT"] = str(port)
    base = f"http://127.0.0.1:{port}"
    env["AIIA_HOST_URL"] = base
    proc = subprocess.Popen(
        ["node", "src/server.js"],
        cwd=str(HOST_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    deadline = time.time() + 5
    last_err = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{base}/health", timeout=0.5) as r:
                if r.status == 200:
                    break
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(0.1)
    else:
        proc.kill()
        out = proc.stdout.read().decode() if proc.stdout else ""
        raise RuntimeError(f"host failed to start: {last_err}\n{out}")

    os.environ["AIIA_HOST_URL"] = base
    yield proc
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()


def test_normalize_inbound():
    p = normalize_inbound(session_key="s1", text="hi", reply_to="m1")
    assert p["session_key"] == "s1"
    assert p["text"] == "hi"
    assert p["channel"] == "feishu"


def test_roundtrip_mock_host(mock_host):
    reply = post_chat({"session_key": "s-test", "text": "ping", "channel": "feishu"})
    assert reply.ok
    assert reply.mock
    assert "ping" in reply.text
    assert reply.session_key == "s-test"


def test_policy_deny_via_mock(mock_host):
    reply = post_chat({"session_key": "s2", "text": "rm -rf /", "channel": "feishu"})
    assert reply.ok
    assert "DENY" in reply.text
