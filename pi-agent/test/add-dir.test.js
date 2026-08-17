import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveDirPath,
  validateDirectory,
  addDirectory,
  removeDirectory,
  listDirectories,
  collectSkillPaths,
  formatAdditionalDirsPrompt,
  parseAddDirArgs,
  storePathForCwd,
} from '../src/add-dir-store.js';
import addDirExtension from '../extensions/add-dir.js';
import { buildPromptSnapshot, clearSnapshotSections } from '../src/prompt-snapshot.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aiia-add-dir-'));
}

describe('Pi /add-dir', () => {
  test('parseAddDirArgs', () => {
    assert.equal(parseAddDirArgs('').action, 'list');
    assert.equal(parseAddDirArgs('list').action, 'list');
    assert.deepEqual(parseAddDirArgs('rm ../x'), { action: 'rm', path: '../x' });
    assert.deepEqual(parseAddDirArgs('/tmp/foo'), { action: 'add', path: '/tmp/foo' });
  });

  test('validateDirectory rejects files and missing', () => {
    const dir = tmp();
    const file = path.join(dir, 'f.txt');
    fs.writeFileSync(file, 'x');
    assert.equal(validateDirectory(file).ok, false);
    assert.equal(validateDirectory(path.join(dir, 'nope')).ok, false);
    assert.equal(validateDirectory(dir).ok, true);
  });

  test('add/list/remove persists under .agent', () => {
    const cwd = tmp();
    const extra = tmp();
    fs.mkdirSync(path.join(extra, 'src'));
    const add = addDirectory(extra, cwd);
    assert.equal(add.ok, true);
    assert.equal(add.added, true);
    assert.ok(fs.existsSync(storePathForCwd(cwd)));
    assert.deepEqual(listDirectories(cwd), [extra]);
    const again = addDirectory(extra, cwd);
    assert.equal(again.added, false);
    const rm = removeDirectory(extra, cwd);
    assert.equal(rm.ok, true);
    assert.deepEqual(listDirectories(cwd), []);
  });

  test('resolve relative and collectSkillPaths', () => {
    const cwd = tmp();
    const sibling = path.join(path.dirname(cwd), path.basename(cwd) + '-sib');
    fs.mkdirSync(sibling, { recursive: true });
    const skills = path.join(sibling, '.agents', 'skills');
    fs.mkdirSync(skills, { recursive: true });
    const rel = path.relative(cwd, sibling);
    const abs = resolveDirPath(rel, cwd);
    assert.equal(abs, path.resolve(sibling));
    assert.deepEqual(collectSkillPaths([abs]), [skills]);
  });

  test('formatAdditionalDirsPrompt', () => {
    const p = formatAdditionalDirsPrompt(['/a', '/b'], '/prim');
    assert.match(p, /additional directories/);
    assert.match(p, /\/a/);
    assert.match(p, /Primary cwd: \/prim/);
    assert.equal(formatAdditionalDirsPrompt([], '/x'), '');
  });

  test('extension registers commands and hooks', async () => {
    const cwd = tmp();
    const extra = tmp();
    const commands = {};
    const hooks = {};
    const tools = {};
    const notes = [];
    const mockPi = {
      registerCommand: (name, opts) => {
        commands[name] = opts;
      },
      registerTool: (tool) => {
        tools[tool.name] = tool;
      },
      on: (ev, fn) => {
        hooks[ev] = fn;
      },
      sendMessage: () => {},
      sendUserMessage: () => {},
    };
    clearSnapshotSections();
    addDirExtension(mockPi);
    assert.equal(typeof commands['add-dir']?.handler, 'function');
    assert.equal(typeof commands['rm-dir']?.handler, 'function');
    assert.equal(typeof commands['list-dirs']?.handler, 'function');
    assert.equal(typeof hooks.resources_discover, 'function');
    assert.equal(typeof tools.list_additional_dirs?.execute, 'function');

    const ctx = {
      cwd,
      ui: { notify: (m) => notes.push(m) },
      isIdle: () => true,
    };
    await commands['add-dir'].handler(extra, ctx);
    assert.ok(listDirectories(cwd).includes(path.resolve(extra)));
    assert.ok(notes.some((n) => /Added|Already/.test(n)));

    const prompt = buildPromptSnapshot({ cwd, env: process.env });
    assert.match(prompt, /additional directories/);

    // skills discover
    const skillRoot = path.join(extra, '.agents', 'skills');
    fs.mkdirSync(skillRoot, { recursive: true });
    const disc = await hooks.resources_discover({ cwd });
    assert.ok(disc.skillPaths.includes(skillRoot));

    await commands['list-dirs'].handler('', ctx);
    await commands['rm-dir'].handler(extra, ctx);
    assert.deepEqual(listDirectories(cwd), []);
  });
});
