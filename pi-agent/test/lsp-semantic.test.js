import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { enableAllExtensions } from './with-all-extensions.js';
import lspExtension from '../extensions/lsp-extension.js';
import semanticSearchExtension from '../extensions/semantic-search.js';

describe('LSP and semantic tools register via pi.registerTool', () => {
  before(() => {
    enableAllExtensions();
  });

  test('lsp_extension registers official tools', () => {
    const tools = {};
    lspExtension({
      registerTool: (t) => {
        tools[t.name] = t;
      },
    });
    assert.equal(typeof tools.lsp_start?.execute, 'function');
    assert.equal(typeof tools.lsp_goto_definition?.execute, 'function');
    assert.equal(typeof tools.lsp_find_references?.execute, 'function');
    assert.equal(tools.lsp_start.execute.length >= 2, true);
  });

  test('semantic_search registers official tools', () => {
    const tools = {};
    semanticSearchExtension({
      registerTool: (t) => {
        tools[t.name] = t;
      },
    });
    assert.equal(typeof tools.semantic_index_workspace?.execute, 'function');
    assert.equal(typeof tools.semantic_search?.execute, 'function');
    assert.equal(tools.semantic_search.execute.length >= 2, true);
  });
});
