/**
 * AIIA memory store — single source of truth in Node (better-sqlite3).
 * Replaces the split Python memory.py so the SQLite read/write and the Pi
 * context-injection hook live in the same process (no cross-stack gap).
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
PRAGMA journal_mode=WAL;
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
`;

export class MemoryStore {
  /** @param {string} dbPath */
  constructor(dbPath) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA);
  }

  /**
   * @param {{content:string, category?:string, tags?:string, initialStrength?:number}} m
   * @returns {number}
   */
  add({ content, category = "user_preference", tags = "", initialStrength = 1.0 }) {
    const now = Date.now();
    const info = this.db
      .prepare(
        `INSERT INTO memories(category, content, tags, initial_strength, access_count, created_at, last_accessed_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(category, content, tags, initialStrength, now, now);
    return Number(info.lastInsertRowid);
  }

  /** Ebbinghaus weight: W(t) = S·e^(−Δt/τ) + log2(access+1)·0.2 */
  weight(row, now = Date.now(), tauMs = 7 * 86400 * 1000) {
    const dt = Math.max(0, now - Number(row.last_accessed_at));
    const decay = Number(row.initial_strength) * Math.exp(-dt / tauMs);
    const freq = Math.log2(Number(row.access_count) + 1) * 0.2;
    return decay + freq;
  }

  /**
   * Top-N active memories above threshold; bumps access_count as a side effect.
   * @returns {string[]}
   */
  active({ threshold = 0.2, limit = 20 } = {}) {
    const now = Date.now();
    const rows = this.db.prepare("SELECT * FROM memories").all();
    const scored = rows
      .map((r) => ({ r, w: this.weight(r, now) }))
      .filter((x) => x.w >= threshold)
      .sort((a, b) => b.w - a.w)
      .slice(0, limit);
    const bump = this.db.prepare(
      "UPDATE memories SET access_count=access_count+1, last_accessed_at=? WHERE id=?",
    );
    const out = [];
    const tx = this.db.transaction((items) => {
      for (const { r } of items) {
        bump.run(now, r.id);
        out.push(String(r.content));
      }
    });
    tx(scored);
    return out;
  }

  /** @returns {{id:number,category:string,content:string}[]} */
  list({ limit = 50 } = {}) {
    return this.db
      .prepare("SELECT id, category, content FROM memories ORDER BY id DESC LIMIT ?")
      .all(limit);
  }

  /** @param {number} id @returns {boolean} */
  remove(id) {
    return this.db.prepare("DELETE FROM memories WHERE id=?").run(id).changes > 0;
  }

  close() {
    this.db.close();
  }
}
