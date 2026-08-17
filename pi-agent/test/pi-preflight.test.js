import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectAiiaFiles,
  quarantineBadExtensions,
  runPreflight,
} from '../src/pi-preflight.js';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiia-preflight-'));
  fs.mkdirSync(path.join(root, 'pi-agent', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pi-agent', 'extensions'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'pi-agent', 'src', 'good.js'),
    'export const ok = 1;\n',
  );
  return root;
}

function writeExt(root, name, content) {
  fs.writeFileSync(path.join(root, 'pi-agent', 'extensions', name), content);
}

describe('S-preflight', () => {
  test('collectAiiaFiles 收集 src + extensions', () => {
    const root = makeProject();
    writeExt(root, 'a.js', 'export default function a() {}\n');
    const { srcFiles, extFiles } = collectAiiaFiles(root);
    assert.equal(srcFiles.length, 1);
    assert.equal(extFiles.length, 1);
  });

  test('runPreflight: 干净项目 → ok', () => {
    const root = makeProject();
    writeExt(root, 'a.js', 'export default function a() {}\n');
    const report = runPreflight(root, { force: true, env: {} });
    assert.equal(report.ok, true);
    assert.equal(report.probeErrors.length, 0);
  });

  test('runPreflight: 语法错误的扩展被隔离，src 错误仅报告', () => {
    const root = makeProject();
    writeExt(root, 'broken.js', 'export default function ( { nope\n');
    const report = runPreflight(root, { force: true, env: {} });
    assert.equal(report.ok, false);
    assert.equal(report.extErrors.length, 1);
    // 坏扩展已移出 extensions 目录
    assert.equal(
      fs.existsSync(path.join(root, 'pi-agent', 'extensions', 'broken.js')),
      false,
    );
    // 禁用记录已写
    const disabledPath = path.join(root, '.agent', 'heal', 'disabled-extensions.json');
    assert.ok(fs.existsSync(disabledPath));
    assert.match(fs.readFileSync(disabledPath, 'utf-8'), /broken/);
  });

  test('runPreflight: src 模块错误 → 报告但不隔离', () => {
    const root = makeProject();
    fs.writeFileSync(
      path.join(root, 'pi-agent', 'src', 'bad-src.js'),
      'export const x = ;\n',
    );
    writeExt(root, 'ok.js', 'export default function ok() {}\n');
    const report = runPreflight(root, { force: true, env: {} });
    assert.equal(report.ok, false);
    assert.equal(report.srcErrors.length, 1);
    // src 文件未被移动
    assert.equal(fs.existsSync(path.join(root, 'pi-agent', 'src', 'bad-src.js')), true);
    assert.equal(report.quarantined.length, 0);
  });

  test('runPreflight: import 依赖缺失的扩展被探测并隔离', () => {
    const root = makeProject();
    writeExt(root, 'dep.js', "import { nothing } from './does-not-exist.js';\nexport default function d() {}\n");
    // 依赖探针只对 extensions 生效；src 语法需全过
    const report = runPreflight(root, { force: true, env: {} });
    // 依赖缺失在 probe 阶段被捕获（坏扩展被隔离）
    assert.equal(
      fs.existsSync(path.join(root, 'pi-agent', 'extensions', 'dep.js')),
      false,
    );
    assert.ok(report.quarantined.length >= 1);
  });

  test('quarantineBadExtensions 只隔离扩展不碰 src', () => {
    const root = makeProject();
    const ext = path.join(root, 'pi-agent', 'extensions', 'x.js');
    const src = path.join(root, 'pi-agent', 'src', 'bad-src.js');
    fs.writeFileSync(ext, 'x');
    fs.writeFileSync(src, 'x');
    const quarantined = quarantineBadExtensions(root, [{ file: ext }, { file: src }], { env: {} });
    assert.equal(quarantined.length, 1);
    assert.equal(quarantined[0].extensionId, 'x');
    assert.equal(fs.existsSync(src), true); // src 未被移动
    assert.equal(fs.existsSync(ext), false); // 扩展已隔离
  });
});
