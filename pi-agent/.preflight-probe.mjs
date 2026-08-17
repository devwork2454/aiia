/**
 * AIIA pre-flight probe（子进程）— import 全部扩展模块，allSettled 定位坏模块。
 * 由 src/pi-preflight.js 以 spawnSync 调用。用法：node .preflight-probe.mjs <files.json>
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const listFile = process.argv[2];
let files = [];
try {
  files = JSON.parse(fs.readFileSync(listFile, 'utf-8'));
} catch {
  console.log('[]');
  process.exit(0);
}

// 拦截入口脚本（cli.js 等）顶层 process.exit，防止杀死探针子进程（报错会作为模块失败收集）
const realExit = process.exit;
process.exit = (code) => {
  throw new Error(`process.exit(${code}) intercepted (entry-script side effect)`);
};
// 吞掉模块求值期间可能的 unhandled rejection 噪音（import 失败已被 allSettled 捕获）
process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

// pi 运行时提供的内部包（原生 node 解析不到，但 pi 加载扩展时可用）
const PI_INTERNAL_PACKAGE_RE =
  /Cannot find (?:package|module) '@?(?:earendil-works|mariozechner)\//;

const results = await Promise.allSettled(files.map((f) => import(pathToFileURL(f))));
const failed = [];
for (let i = 0; i < results.length; i += 1) {
  const r = results[i];
  if (r.status === 'rejected') {
    const message = String(r.reason?.message || r.reason || 'module load failed');
    if (PI_INTERNAL_PACKAGE_RE.test(message)) continue; // pi 内置包，忽略
    failed.push({
      file: files[i],
      error: message.slice(0, 500),
    });
  }
}
console.log(JSON.stringify(failed));
