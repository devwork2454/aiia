from pathlib import Path

from adapter.memory import (
    active_memories,
    add_memory,
    append_message,
    connect,
    init_db,
    memory_weight,
)


def test_init_and_session_messages(tmp_path: Path):
    db = tmp_path / "t.db"
    init_db(db)
    with connect(db) as conn:
        append_message(conn, "feishu:c:u", "user", "hello")
        append_message(conn, "feishu:c:u", "assistant", "hi")
        conn.commit()
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE session_key=? ORDER BY id",
            ("feishu:c:u",),
        ).fetchall()
        assert [r["role"] for r in rows] == ["user", "assistant"]
        assert rows[0]["content"] == "hello"


def test_memory_weight_and_active(tmp_path: Path):
    db = tmp_path / "m.db"
    init_db(db)
    with connect(db) as conn:
        add_memory(conn, "prefer concise answers", category="user_preference")
        add_memory(conn, "project uses Python", category="coding_style", initial_strength=0.9)
        conn.commit()
        active = active_memories(conn, threshold=0.01)
        assert any("concise" in m for m in active)
        row = conn.execute("SELECT * FROM memories LIMIT 1").fetchone()
        assert memory_weight(row) > 0
