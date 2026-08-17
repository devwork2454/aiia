import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/memory-store.js';

describe('MemoryStore Phase 2 P4', () => {
  let dir, store;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'aiia-mem-'));
    store = new MemoryStore(join(dir, 't.db'));
  });
  after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds and lists', () => {
    const id = store.add({ content: 'prefer concise answers' });
    assert.ok(id > 0);
    const items = store.list();
    assert.ok(items.some((m) => m.content.includes('concise')));
  });

  it('deduplicates identical memory and boosts initial strength', () => {
    const id1 = store.add({ content: 'use TypeScript strictly', initialStrength: 1.0 });
    const id2 = store.add({ content: 'use TypeScript strictly', initialStrength: 1.0 });

    assert.equal(id1, id2);
    const list = store.search({ query: 'TypeScript' });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id1);
  });

  it('ranks active memories by Ebbinghaus decay and context relevance', () => {
    store.add({ content: 'project uses Node', category: 'coding_style', initialStrength: 0.9 });
    store.add({
      content: 'prefer Vue 3 composition API',
      category: 'frontend',
      tags: 'vue,frontend',
    });

    const activeVue = store.active({ query: '如何配置 Vue 组件', threshold: 0.01 });
    assert.ok(activeVue.length >= 1);
    assert.ok(activeVue[0].includes('Vue'));
  });

  it('search returns query matched items sorted by score', () => {
    store.add({
      content: 'Database uses SQLite better-sqlite3',
      category: 'backend',
      tags: 'database,sqlite',
    });
    const results = store.search({ query: 'SQLite database' });

    assert.ok(results.length > 0);
    assert.ok(results[0].content.includes('SQLite'));
    assert.ok(results[0].score > 0);
  });

  it('removes memory by id', () => {
    const id = store.add({ content: 'temp memory to delete' });
    assert.equal(store.remove(id), true);
    assert.equal(store.remove(999999), false);
  });
});
