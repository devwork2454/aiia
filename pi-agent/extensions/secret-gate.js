/**
 * AIIA Secret Gate & Redaction Extension (Item B)
 * 1. 在 before_agent_start 钩子中仅向 System Prompt 注入可用的 Secret Key 名称清单（零知识注入）。
 * 2. 在 tool_result 钩子中对工具输出脱敏（Pi 字段是 content）。
 */

import { loadSecretPairs, redactToolResultEvent } from '../src/secret-redact.js';

export default function secretGateExtension(pi) {
  const secretPairs = loadSecretPairs();
  const secretKeys = Object.keys(secretPairs);

  pi.on('before_agent_start', async (event) => {
    if (secretKeys.length === 0) return;
    const notice = [
      '\n[AIIA Security Gate]',
      '已在系统环境凭据中检测到以下可用的 Secret Key 变量名：',
      `  - ${secretKeys.join('\n  - ')}`,
      '【安全约束】：严禁在回复中输出这些变量的明文值。若需在命令中引用，请确保不直接打印它们。'
    ].join('\n');

    if (typeof event.appendSystemPrompt === 'function') {
      event.appendSystemPrompt(notice);
    } else if (event.systemPrompt !== undefined) {
      event.systemPrompt += notice;
    } else {
      return { appendSystemPrompt: notice };
    }
  });

  pi.on('tool_result', async (event) => {
    if (secretKeys.length === 0) return;
    redactToolResultEvent(event, secretPairs);
  });
}
