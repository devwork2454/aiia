-- AIIA local state (SQLite)
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS sessions (
  session_key TEXT PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'feishu',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key)
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_key, created_at);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'user_preference',
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  initial_strength REAL NOT NULL DEFAULT 1.0,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
