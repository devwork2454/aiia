import { test, describe, before } from "node:test";
import { enableAllExtensions } from "./with-all-extensions.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../src/memory-store.js";
import {
  tokenize,
  scoreText,
  resolveKnowledgeRoots,
  extractTitle,
  makeSnippet,
  searchMarkdownDocs,
  hybridKbSearch,
  tryQmdSearch,
  kbSearch,
  formatKbSearchResult,
  isKbSearchDisabled,
} from "../src/kb-search.js";
import kbSearchExtension from "../extensions/kb-search.js";

function tmpDir(prefix = "aiia-kb-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("S3 Hybrid KB search", () => {
  before(() => {
    enableAllExtensions();
  });

  test("tokenize and scoreText rank title hits higher", () => {
    assert.deepEqual(tokenize("Hybrid RAG kb"), ["hybrid", "rag", "kb"]);
    const a = scoreText("hybrid rag", "something about hybrid rag retrieval", "Notes");
    const b = scoreText("hybrid rag", "unrelated text", "Hybrid RAG design");
    assert.ok(b > a);
  });

  test("resolveKnowledgeRoots honors AIIA_KB_PATHS", () => {
    const cwd = "/tmp/proj";
    const roots = resolveKnowledgeRoots(cwd, { AIIA_KB_PATHS: "kb:./docs/k" });
    assert.equal(roots[0], path.resolve(cwd, "kb"));
    assert.equal(roots[1], path.resolve(cwd, "docs/k"));
  });

  test("extractTitle and makeSnippet", () => {
    const md = "# Hybrid Engine\n\nBody about LanceDB later.\n";
    assert.equal(extractTitle(md, "/x/y.md"), "Hybrid Engine");
    const snip = makeSnippet("aaa hybrid rag bbb ".repeat(20), "hybrid", { maxChars: 60 });
    assert.match(snip, /hybrid/i);
    assert.ok(snip.length <= 80);
  });

  test("searchMarkdownDocs finds keyword hits", () => {
    const dir = tmpDir();
    const kb = path.join(dir, "knowledge");
    fs.mkdirSync(kb, { recursive: true });
    fs.writeFileSync(
      path.join(kb, "rag.md"),
      "# Hybrid RAG\n\nUse kb_search for lexical recall over markdown.\n",
    );
    fs.writeFileSync(path.join(kb, "other.md"), "# Unrelated\n\nCats and dogs.\n");
    const hits = searchMarkdownDocs("kb_search lexical", { roots: [kb], limit: 5 });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].source, "doc");
    assert.match(hits[0].title, /Hybrid RAG/i);
    assert.match(hits[0].snippet, /kb_search|lexical/i);
  });

  test("hybridKbSearch merges memory + docs by score", () => {
    const dir = tmpDir();
    const kb = path.join(dir, "knowledge");
    fs.mkdirSync(kb, { recursive: true });
    fs.writeFileSync(path.join(kb, "a.md"), "# Doc\n\nSQLite FTS knowledge notes.\n");
    const db = path.join(dir, "t.db");
    const store = new MemoryStore(db);
    store.add({ content: "Prefer SQLite FTS for knowledge search before LanceDB", category: "build_info" });
    const payload = hybridKbSearch("SQLite FTS", {
      cwd: dir,
      env: { AIIA_KB_PATHS: kb },
      memoryStore: store,
      limit: 5,
    });
    store.close();
    assert.equal(payload.backend, "builtin");
    assert.ok(payload.results.length >= 2);
    const sources = new Set(payload.results.map((r) => r.source));
    assert.ok(sources.has("memory"));
    assert.ok(sources.has("doc"));
    for (const r of payload.results) {
      assert.ok(["memory", "doc"].includes(r.source));
      assert.ok(r.path);
      assert.ok(r.title);
      assert.ok(typeof r.snippet === "string");
      assert.ok(typeof r.score === "number");
    }
  });

  test("tryQmdSearch returns null when qmd missing", () => {
    const fakeSpawn = () => ({ error: new Error("ENOENT"), status: null, stdout: "" });
    assert.equal(tryQmdSearch("x", { spawn: fakeSpawn }), null);
  });

  test("tryQmdSearch parses JSON when qmd succeeds", () => {
    const fakeSpawn = () => ({
      status: 0,
      stdout: JSON.stringify([
        { path: "/k/a.md", title: "A", snippet: "hello", score: 1.2 },
      ]),
    });
    const res = tryQmdSearch("hello", { spawn: fakeSpawn, limit: 3 });
    assert.equal(res.backend, "qmd");
    assert.equal(res.results[0].source, "qmd");
    assert.equal(res.results[0].title, "A");
  });

  test("kbSearch disabled and formatKbSearchResult", () => {
    assert.equal(isKbSearchDisabled({ KB_SEARCH_DISABLED: "1" }), true);
    const empty = kbSearch("anything", { env: { KB_SEARCH_DISABLED: "1" }, preferQmd: false });
    assert.equal(empty.backend, "disabled");
    assert.equal(empty.results.length, 0);
    assert.match(formatKbSearchResult(empty), /No KB hits/);
    assert.match(
      formatKbSearchResult({
        backend: "builtin",
        results: [{ source: "doc", path: "/t.md", title: "T", snippet: "s", score: 1 }],
      }),
      /KB search/,
    );
  });

  test("extension registers kb_search tool and returns compact hits", async () => {
    const dir = tmpDir();
    const kb = path.join(dir, "knowledge");
    fs.mkdirSync(kb, { recursive: true });
    fs.writeFileSync(path.join(kb, "note.md"), "# Note\n\nTrajectory logging JSONL.\n");
    const db = path.join(dir, "aiia.db");
    process.env.AIIA_DB = db;
    process.env.AIIA_KB_PATHS = kb;
    delete process.env.KB_SEARCH_DISABLED;

    const tools = {};
    const mockPi = {
      registerTool: (t) => {
        tools[t.name] = t;
      },
      on: () => {},
    };
    kbSearchExtension(mockPi);
    assert.equal(typeof tools.kb_search?.execute, "function");

    const store = new MemoryStore(db);
    store.add({ content: "Trajectory JSONL is append-only", tags: "trajectory" });
    store.close();

    const res = await tools.kb_search.execute(
      "t1",
      { query: "Trajectory JSONL", limit: 5 },
      undefined,
      undefined,
      { cwd: dir },
    );
    assert.ok(res.content?.[0]?.text);
    assert.ok(res.details?.count >= 1);
    assert.ok(Array.isArray(res.details.results));
    for (const r of res.details.results) {
      assert.ok(r.path);
      assert.ok(r.title);
      assert.ok("snippet" in r);
      // must not dump entire file bodies in details beyond snippet
      assert.ok(String(r.snippet).length <= 300);
    }
  });
});
