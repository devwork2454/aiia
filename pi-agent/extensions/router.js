/**
 * AIIA Dynamic Model Router Evaluator (Phase 2 P3)
 *
 * 依据 Prompt 复杂度、多模态 (Vision)、上下文 Token 长度及关键词意图，
 * 智能分流请求至 low / medium / high / reasoning 模型层级。
 *
 * 默认仅对本地分层反代（local-proxy / 127.0.0.1:4000）或已是层级别名的模型改写；
 * 直连 provider（如 Charon→xAI 的 grok-4.5、DeepSeek）保持原 model，避免把别名打到上游 API。
 */

const COMPLEX_KEYWORDS = [
  'refactor',
  'architecture',
  'debug',
  'redesign',
  '重构',
  '架构',
  '报错',
  '死锁',
  '并发',
  '漏洞',
  '性能优化',
];
const REASONING_KEYWORDS = [
  '证明',
  '深度推导',
  '数学建模',
  'prover',
  'formal verification',
  'benchmark',
];
const TIER_MODELS = new Set(['low', 'medium', 'high', 'reasoning']);

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * 自动去 1api 真实配置目录中寻找档位对应的真实模型 ID
 */
function resolve1apiTier(tierAlias, baseUrl) {
  if (!['low', 'mid', 'medium', 'high', 'reasoning'].includes(tierAlias)) return tierAlias;
  const targetKey = tierAlias === 'medium' ? 'mid' : tierAlias;

  try {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const providersDir = path.join(configHome, '1api', 'providers');
    if (!fs.existsSync(providersDir)) return tierAlias;

    for (const name of fs.readdirSync(providersDir)) {
      const pPath = path.join(providersDir, name, 'provider.json');
      if (fs.existsSync(pPath)) {
        const data = JSON.parse(fs.readFileSync(pPath, 'utf8'));
        // 若提供了 baseUrl 且不匹配，则跳过
        if (baseUrl && data.endpoint && !baseUrl.includes(data.endpoint.replace(/\/+$/, ''))) {
          continue;
        }
        if (data[targetKey]) return data[targetKey];
        if (data['mid']) return data['mid']; // Fallback
      }
    }
  } catch (e) {
    console.debug('Failed to resolve 1api tier:', e.message);
  }
  return tierAlias;
}

/**
 * 根据 payload 消息特征计算目标模型路由
 * @param {object} payload
 * @param {object} env
 * @returns {'low' | 'medium' | 'high' | 'reasoning' | string}
 */
export function evaluateModelRoute(payload = {}, env = process.env) {
  if (env.ROUTER_FORCE_MODEL) {
    return env.ROUTER_FORCE_MODEL;
  }

  const lowThreshold = parseInt(env.ROUTER_LOW_THRESHOLD || '500', 10);
  const mediumThreshold = parseInt(env.ROUTER_MEDIUM_THRESHOLD || '4000', 10);

  const input = payload.input || payload.messages || [];
  if (!Array.isArray(input) || input.length === 0) {
    return 'high';
  }

  let hasVision = false;
  let totalTextLength = 0;
  let allText = '';

  for (const msg of input) {
    if (typeof msg.content === 'string') {
      totalTextLength += msg.content.length;
      allText += ' ' + msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.type === 'image_url' || c.type === 'image') {
          hasVision = true;
        }
        const t = c.text || c.content || '';
        if (typeof t === 'string') {
          totalTextLength += t.length;
          allText += ' ' + t;
        }
      }
    }
  }

  const lowerText = allText.toLowerCase();

  // 1. 包含图像 / Vision 多模态分析 -> 高阶模型
  if (hasVision) {
    return 'high';
  }

  // 2. 包含深度推理关键词 -> 推理模型
  if (REASONING_KEYWORDS.some((kw) => lowerText.includes(kw))) {
    return 'reasoning';
  }

  // 3. 包含复杂架构/重构/调试关键词 或 超长上下文 -> 高阶模型
  if (COMPLEX_KEYWORDS.some((kw) => lowerText.includes(kw)) || totalTextLength >= mediumThreshold) {
    return 'high';
  }

  // 4. 中等上下文长度 -> 中阶模型
  if (totalTextLength > lowThreshold || input.length > 3) {
    return 'medium';
  }

  // 5. 短文本、简单单轮问答 -> 低成本模型
  return 'low';
}

function envFlag(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return null;
}

/**
 * 是否应对当前会话改写 payload.model。
 * @param {{ model?: { id?: string, provider?: string, baseUrl?: string } }} ctx
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 */
export function shouldRewriteModel(ctx = {}, env = process.env) {
  if (env.ROUTER_FORCE_MODEL) {
    return true;
  }

  const enabled = envFlag(env.ROUTER_ENABLED);
  if (enabled === false) {
    return false;
  }
  if (enabled === true) {
    return true;
  }

  const model = ctx.model || {};
  const provider = String(model.provider || '');
  const baseUrl = String(model.baseUrl || '');
  const modelId = String(model.id || '');

  if (provider === 'local-proxy') {
    return true;
  }
  if (/127\.0\.0\.1:4000|localhost:4000/.test(baseUrl)) {
    return true;
  }
  if (TIER_MODELS.has(modelId)) {
    return true;
  }

  return false;
}

/**
 * 若应改写则返回新 payload；否则返回 undefined（让 Pi 保持原请求）。
 */
export function resolveRoutedPayload(payload = {}, ctx = {}, env = process.env) {
  if (!shouldRewriteModel(ctx, env)) {
    return undefined;
  }
  let targetModel = evaluateModelRoute(payload, env);

  // 真源翻译：如果是 1api 提供的直连，绝对不能发别名，必须翻译成真实的 provider.json 里的 ID
  const provider = String(ctx?.model?.provider || '');
  if (provider === '1api' || provider === 'charon' || provider === 'local-proxy') {
    targetModel = resolve1apiTier(targetModel, ctx?.model?.baseUrl);
  }

  return { ...payload, model: targetModel };
}

export default function routerExtension(pi) {
  pi.on('before_provider_request', (event, ctx) => {
    const payload = event?.payload ?? event?.req ?? {};
    return resolveRoutedPayload(payload, ctx, process.env);
  });
}
