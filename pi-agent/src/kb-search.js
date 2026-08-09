/**
 * AIIA Hybrid KB search (S3 minimum slice).
 *
 * Builtin backend (default, no external deps):
 *   - long-term memories (MemoryStore lexical + Ebbinghaus relevance)
 *   - Markdown under knowledge roots (term-hit scoring)
 *
 * Optional: if `qmd` is on PATH (or QMD_BIN), prefer `qmd search --json`.
 * LanceDB / LSP remain deferred (corpus / scale conditional) — not implemented here.
 *
 * Env:
 *   AIIA_KB_PATHS     colon-separated roots (default: ~/.config/aiia/knowledge + <cwd>/knowledge)
 *   KB_SEARCH_DISABLED=1  no-op empty results
 *   QMD_BIN           override qmd executable
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";

const DEFAULT_LIMIT = 8;
const MAX_FILES = 200;
const MAX_FILE_BYTES = 256 * 1024;
const SNIPPET_CHARS = 240;

export function isKbSearchDisabled(env = process.env) {
  return env.KB_SEARCH_DISABLED === "1" || env.KB_SEARCH_DISABLED === "true";
}

export function tokenize(query = "") {
  return String(query)
    .toLowerCase()
    .split(/[\s,.;:!?()[\]{}"'`|_+\-=/\\]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

export function resolveKnowledgeRoots(cwd = process.cwd(), env = process.env) {
  const raw = env.AIIA_KB_PATHS;
  if (raw && String(raw).trim()) {
    return String(raw)
      .split(":")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => resolve(cwd, p));
  }
  return [
    join(homedir(), ".config", "aiia", "knowledge"),
    resolve(cwd, "knowledge"),
  ];
}

export function scoreText(query, text = "", title = "") {
  const words = tokenize(query);
  if (words.length === 0) return 0;
  const hay = `${title}\n${text}`.toLowerCase();
  let hits = 0;
  let titleHits = 0;
  const titleLower = String(title).toLowerCase();
  for (const w of words) {
    if (hay.includes(w)) hits++;
    if (titleLower.includes(w)) titleHits++;
  }
  return (hits / words.length) * 2.5 + titleHits * 0.5;
}

export function extractTitle(content, filePath) {
  const m = String(content || "").match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  return basename(filePath, extname(filePath));
}

export function makeSnippet(content, query, { maxChars = SNIPPET_CHARS } = {}) {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const words = tokenize(query);
  let idx = 0;
  for (const w of words) {
    const i = text.toLowerCase().indexOf(w);
    if (i >= 0) {
      idx = Math.max(0, i - 40);
      break;
    }
  }
  let slice = text.slice(idx, idx + maxChars);
  if (idx > 0) slice = "…" + slice;
  if (idx + maxChars < text.length) slice = slice + "…";
  return slice;
}

function walkMarkdown(root, out, { maxFiles = MAX_FILES } = {}) {
  if (!existsSync(root) || out.length >= maxFiles) return;
  let st;
  try {
    st = statSync(root);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (/\.(md|mdx|txt)$/i.test(root)) out.push(root);
    return;
  }
  if (!st.isDirectory()) return;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= maxFiles) break;
    if (ent.name.startsWith(".")) continue;
    const p = join(root, ent.name);
    if (ent.isDirectory()) walkMarkdown(p, out, { maxFiles });
    else if (ent.isFile() && /\.(md|mdx|txt)$/i.test(ent.name)) out.push(p);
  }
}

export function listMarkdownFiles(roots, { maxFiles = MAX_FILES } = {}) {
  const out = [];
  for (const root of roots) {
    walkMarkdown(root, out, { maxFiles });
    if (out.length >= maxFiles) break;
  }
  return out;
}

/**
 * @returns {{source:string,path:string,title:string,snippet:string,score:number}[]}
 */
export function searchMarkdownDocs(query, { roots = [], limit = DEFAULT_LIMIT } = {}) {
  const files = listMarkdownFiles(roots);
  const scored = [];
  for (const filePath of files) {
    let content = "";
    try {
      const st = statSync(filePath);
      if (st.size > MAX_FILE_BYTES) continue;
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const title = extractTitle(content, filePath);
    const score = scoreText(query, content, title);
    if (score <= 0) continue;
    scored.push({
      source: "doc",
      path: filePath,
      title,
      snippet: makeSnippet(content, query),
      score,
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * @param {import('./memory-store.js').MemoryStore | null} store
 */
export function searchMemories(query, store, { limit = DEFAULT_LIMIT } = {}) {
  if (!store || typeof store.search !== "function") return [];
  const items = store.search({ query, limit });
  return items.map((m) => ({
    source: "memory",
    path: `memory://${m.id}`,
    title: m.category || "memory",
    snippet: String(m.content || "").slice(0, SNIPPET_CHARS),
    score: Number(m.score) || 0,
  }));
}

/**
 * Prefer qmd when available. Returns null if qmd missing / fails / empty parse.
 */
export function tryQmdSearch(query, {
  limit = DEFAULT_LIMIT,
  spawn = spawnSync,
  env = process.env,
  timeoutMs = 8000,
} = {}) {
  const bin = env.QMD_BIN || "qmd";
  const res = spawn(bin, ["search", query, "--json", "--limit", String(limit)], {
    encoding: "utf8",
    timeout: timeoutMs,
    env,
  });
  if (res.error || res.status !== 0) return null;
  const out = String(res.stdout || "").trim();
  if (!out) return null;
  try {
    const parsed = JSON.parse(out);
    const rows = Array.isArray(parsed) ? parsed : parsed.results || parsed.hits || [];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return {
      backend: "qmd",
      results: rows.slice(0, limit).map((r) => ({
        source: "qmd",
        path: String(r.path || r.file || r.id || ""),
        title: String(r.title || basename(String(r.path || "untitled"))),
        snippet: String(r.snippet || r.excerpt || r.text || "").slice(0, SNIPPET_CHARS),
        score: Number(r.score ?? r.rank ?? 0),
      })),
    };
  } catch {
    return null;
  }
}

export function hybridKbSearch(query, {
  cwd = process.cwd(),
  env = process.env,
  limit = DEFAULT_LIMIT,
  memoryStore = null,
  roots = null,
} = {}) {
  const knowledgeRoots = roots || resolveKnowledgeRoots(cwd, env);
  const mem = searchMemories(query, memoryStore, { limit });
  const docs = searchMarkdownDocs(query, { roots: knowledgeRoots, limit });
  const merged = [...mem, ...docs].sort((a, b) => b.score - a.score).slice(0, limit);
  return { backend: "builtin", results: merged, roots: knowledgeRoots };
}

/**
 * Top-level search used by the extension.
 */
export function kbSearch(query, opts = {}) {
  const q = String(query || "").trim();
  const env = opts.env || process.env;
  if (!q || isKbSearchDisabled(env)) {
    return { backend: "disabled", results: [], roots: [] };
  }
  if (opts.preferQmd !== false) {
    const qmd = tryQmdSearch(q, { ...opts, env });
    if (qmd) return qmd;
  }
  return hybridKbSearch(q, opts);
}

/** Format compact tool text: only path/title/snippet/score (no full docs). */
export function formatKbSearchResult(payload) {
  const results = payload?.results || [];
  if (results.length === 0) {
    return `No KB hits (backend=${payload?.backend || "none"}).`;
  }
  const lines = results.map((r, i) => {
    const rel =
      r.source === "memory"
        ? r.path
        : r.path
          ? relative(process.cwd(), r.path) || r.path
          : "";
    return `${i + 1}. [${r.source}] ${r.title} score=${Number(r.score).toFixed(2)}\n   path: ${rel}\n   ${r.snippet}`;
  });
  return `KB search (${payload.backend}, ${results.length} hits):\n` + lines.join("\n");
}
