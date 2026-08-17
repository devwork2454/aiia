/**
 * AIIA memory store — single source of truth in Node (better-sqlite3).
 * Replaces the split Python memory.py so the SQLite read/write and the Pi
 * context-injection hook live in the same process (no cross-stack gap).
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
   * 添加记忆，带有自动去重与强度加强机制
   * @param {{content:string, category?:string, tags?:string, initialStrength?:number}} m
   * @returns {number} 记忆条目的 id
   */
  add({ content, category = 'user_preference', tags = '', initialStrength = 1.0 }) {
    const now = Date.now();
    const cleanContent = String(content || '').trim();
    if (!cleanContent) return 0;

    // 查重逻辑：如果相同内容已存在，增强强度并更新访问计数
    const existing = this.db
      .prepare('SELECT id, initial_strength, access_count FROM memories WHERE content = ? LIMIT 1')
      .get(cleanContent);

    if (existing) {
      const newStrength = Math.min(5.0, Number(existing.initial_strength) + 0.5);
      this.db
        .prepare(
          'UPDATE memories SET initial_strength = ?, access_count = access_count + 1, last_accessed_at = ? WHERE id = ?',
        )
        .run(newStrength, now, existing.id);
      return existing.id;
    }

    const info = this.db
      .prepare(
        `INSERT INTO memories(category, content, tags, initial_strength, access_count, created_at, last_accessed_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(category, cleanContent, tags, initialStrength, now, now);
    return Number(info.lastInsertRowid);
  }

  /**
   * 艾宾浩斯时间衰减权重: W(t) = S·e^(−Δt/τ) + log2(access+1)·0.2
   */
  weight(row, now = Date.now(), tauMs = 7 * 86400 * 1000) {
    const dt = Math.max(0, now - Number(row.last_accessed_at));
    const decay = Number(row.initial_strength) * Math.exp(-dt / tauMs);
    const freq = Math.log2(Number(row.access_count) + 1) * 0.2;
    return decay + freq;
  }

  /**
   * 计算上下文 Query 与记忆内容的关联系数得分
   */
  calculateRelevance(query = '', content = '', tags = '') {
    if (!query) return 0;
    const cleanQuery = query.toLowerCase();
    const targetContent = content.toLowerCase();
    const targetTags = tags.toLowerCase();

    // 简单词块匹配加权
    const words = cleanQuery.split(/[\s,._\-/]+/).filter((w) => w.length > 1);
    if (words.length === 0) return 0;

    let hits = 0;
    for (const w of words) {
      if (targetContent.includes(w) || targetTags.includes(w)) hits++;
    }

    return (hits / words.length) * 2.5;
  }

  /**
   * 获取按“艾宾浩斯衰减 + 上下文关联度”Top-N 激活记忆，并在侧效应中更新访问计数
   * @param {{query?:string, category?:string, threshold?:number, limit?:number}} opts
   * @returns {string[]}
   */
  active({ query = '', category = '', threshold = 0.2, limit = 20 } = {}) {
    const now = Date.now();
    let sql = 'SELECT * FROM memories';
    const params = [];
    if (category) {
      sql += ' WHERE category = ?';
      params.push(category);
    }
    sql += ' ORDER BY last_accessed_at DESC LIMIT 5000';

    const rows = this.db.prepare(sql).all(...params);
    const scored = rows
      .map((r) => {
        const w = this.weight(r, now);
        const rel = this.calculateRelevance(query, r.content, r.tags);
        return { r, totalWeight: w + rel };
      })
      .filter((x) => x.totalWeight >= threshold)
      .sort((a, b) => b.totalWeight - a.totalWeight)
      .slice(0, limit);

    const bump = this.db.prepare(
      'UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?',
    );
    const out = [];
    const tx = this.db.transaction((items) => {
      for (const { r } of items) {
        if (now - r.last_accessed_at > 60000) {
          bump.run(now, r.id);
        }
        out.push(String(r.content));
      }
    });
    tx(scored);
    return out;
  }

  /**
   * 搜索记忆列表并附带评分
   */
  search({ query = '', category = '', limit = 20 } = {}) {
    const now = Date.now();
    let sql = 'SELECT * FROM memories';
    const params = [];
    if (category) {
      sql += ' WHERE category = ?';
      params.push(category);
    }
    sql += ' ORDER BY id DESC LIMIT 500';

    const rows = this.db.prepare(sql).all(...params);
    return rows
      .map((r) => ({
        id: r.id,
        category: r.category,
        content: r.content,
        tags: r.tags,
        weight: this.weight(r, now),
        relevance: this.calculateRelevance(query, r.content, r.tags),
        score: this.weight(r, now) + this.calculateRelevance(query, r.content, r.tags),
      }))
      .filter((m) => !query || m.relevance > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** @returns {{id:number,category:string,content:string}[]} */
  list({ limit = 50 } = {}) {
    return this.db
      .prepare('SELECT id, category, content FROM memories ORDER BY id DESC LIMIT ?')
      .all(limit);
  }

  /** @param {number} id @returns {boolean} */
  remove(id) {
    return this.db.prepare('DELETE FROM memories WHERE id=?').run(id).changes > 0;
  }

  close() {
    this.db.close();
  }
}
