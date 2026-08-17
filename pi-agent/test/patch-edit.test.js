import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import patchEditExtension from '../extensions/patch-edit.js';

test('patch_edit extension', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiia-patch-test-'));
  const testFile = path.join(tmpDir, 'test.js');

  fs.writeFileSync(testFile, 'function hello() {\n  console.log("world");\n}\n', 'utf8');

  let registeredTool = null;
  let emittedResult = null;
  const pi = {
    registerTool: (t) => {
      registeredTool = t;
    },
    emit: (event, payload) => {
      if (event === 'tool_result') emittedResult = payload;
    },
  };

  patchEditExtension(pi);
  assert.ok(registeredTool, 'Tool should be registered');
  assert.strictEqual(registeredTool.name, 'patch_edit');

  const udiff = `--- test.js
+++ test.js
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("world");
+  console.log("universe");
 }`;

  const result = await registeredTool.handler(
    {
      path: testFile,
      udiff: udiff,
      description: 'change world to universe',
    },
    { cwd: tmpDir },
  );

  assert.strictEqual(result.isError, undefined);

  const newContent = fs.readFileSync(testFile, 'utf8');
  assert.strictEqual(newContent, 'function hello() {\n  console.log("universe");\n}\n');
  assert.ok(emittedResult, 'Should emit tool_result');
  assert.strictEqual(emittedResult.toolName, 'patch_edit');
  assert.strictEqual(emittedResult.input.path, testFile);

  // cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
