/**
 * AIIA Secret Gate & Redaction Extension (Item B)
 * 1. 在 before_agent_start 钩子中仅向 System Prompt 注入可用的 Secret Key 名称清单（零知识注入）。
 * 2. 在 tool_result 钩子中对大模型获取到的工具输出进行全局敏感词打码脱敏 (***REDACTED:KEY_NAME***)。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const SECRETS_FILE = path.join(os.homedir(), '.secrets', 'env');

/** 解析 ~/.secrets/env 获取 Key-Value 映射 */
function loadSecretPairs() {
  if (!fs.existsSync(SECRETS_FILE)) return {};
  const pairs = {};
  const content = fs.readFileSync(SECRETS_FILE, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // 移除可能存在的引号
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && val && val.length >= 8) { // 过滤掉太短的公共词库
        pairs[key] = val;
      }
    }
  }
  return pairs;
}

export default function secretGateExtension(pi) {
  const secretPairs = loadSecretPairs();
  const secretKeys = Object.keys(secretPairs);

  // 1. before_agent_start: 零知识注入
  pi.on('before_agent_start', async (event) => {
    if (secretKeys.length > 0) {
      const notice = [
        '\n[AIIA Security Gate]',
        `已在系统环境凭据中检测到以下可用的 Secret Key 变量名：`,
        `  - ${secretKeys.join('\n  - ')}`,
        '【安全约束】：严禁在回复中输出这些变量的明文值。若需在命令中引用，请确保不直接打印它们。'
      ].join('\n');
      
      // 兼容 appendSystemPrompt 和 systemPrompt 赋值
      if (typeof event.appendSystemPrompt === 'function') {
        event.appendSystemPrompt(notice);
      } else if (event.systemPrompt !== undefined) {
        event.systemPrompt += notice;
      }
    }
  });

  // 2. tool_result: 敏感词全局脱敏过滤
  pi.on('tool_result', async (event) => {
    if (secretKeys.length === 0 || !event.result) return;

    let resultStr = typeof event.result === 'string' 
      ? event.result 
      : JSON.stringify(event.result);

    let redacted = false;
    for (const [key, val] of Object.entries(secretPairs)) {
      if (resultStr.includes(val)) {
        resultStr = resultStr.split(val).join(`***REDACTED:${key}***`);
        redacted = true;
      }
      const escapedVal = JSON.stringify(val).slice(1, -1);
      if (escapedVal !== val && resultStr.includes(escapedVal)) {
        resultStr = resultStr.split(escapedVal).join(`***REDACTED:${key}***`);
        redacted = true;
      }
    }

    if (redacted) {
      if (typeof event.result === 'string') {
        event.result = resultStr;
      } else {
        try {
          event.result = JSON.parse(resultStr);
        } catch {
          event.result = resultStr;
        }
      }
    }
  });
}
