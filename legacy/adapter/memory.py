"""SQLite memory / session store for AIIA."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "data" / "schema.sql"
DEFAULT_DB = Path(__file__).resolve().parents[1] / "data" / "aiia.db"


def connect(db_path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else DEFAULT_DB
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: Path | str | None = None) -> Path:
    path = Path(db_path) if db_path else DEFAULT_DB
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    with connect(path) as conn:
        conn.executescript(schema)
        conn.commit()
    return path


def ensure_session(conn: sqlite3.Connection, session_key: str, channel: str = "feishu") -> None:
    now = int(time.time() * 1000)
    conn.execute(
        """
        INSERT INTO sessions(session_key, channel, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_key) DO UPDATE SET updated_at=excluded.updated_at
        """,
        (session_key, channel, now, now),
    )


def append_message(conn: sqlite3.Connection, session_key: str, role: str, content: str) -> None:
    now = int(time.time() * 1000)
    ensure_session(conn, session_key)
    conn.execute(
        "INSERT INTO messages(session_key, role, content, created_at) VALUES (?, ?, ?, ?)",
        (session_key, role, content, now),
    )
    conn.execute("UPDATE sessions SET updated_at=? WHERE session_key=?", (now, session_key))


def add_memory(
    conn: sqlite3.Connection,
    content: str,
    category: str = "user_preference",
    tags: str = "",
    initial_strength: float = 1.0,
) -> int:
    now = int(time.time() * 1000)
    cur = conn.execute(
        """
        INSERT INTO memories(category, content, tags, initial_strength, access_count, created_at, last_accessed_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
        """,
        (category, content, tags, initial_strength, now, now),
    )
    return int(cur.lastrowid)


def memory_weight(row: sqlite3.Row, now_ms: int | None = None, tau_ms: float = 7 * 86400 * 1000) -> float:
    import math

    now = now_ms if now_ms is not None else int(time.time() * 1000)
    time_diff = max(0, now - int(row["last_accessed_at"]))
    decay = float(row["initial_strength"]) * math.exp(-time_diff / tau_ms)
    frequency_boost = math.log2(int(row["access_count"]) + 1) * 0.2
    return decay + frequency_boost


def active_memories(
    conn: sqlite3.Connection, threshold: float = 0.2, limit: int = 20
) -> list[str]:
    now = int(time.time() * 1000)
    rows = conn.execute("SELECT * FROM memories").fetchall()
    scored = [(memory_weight(r, now), r) for r in rows]
    scored = [(w, r) for w, r in scored if w >= threshold]
    scored.sort(key=lambda x: x[0], reverse=True)
    out: list[str] = []
    for _, row in scored[:limit]:
        conn.execute(
            "UPDATE memories SET access_count=access_count+1, last_accessed_at=? WHERE id=?",
            (now, row["id"]),
        )
        out.append(str(row["content"]))
    return out
