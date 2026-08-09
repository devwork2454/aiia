/**
 * AIIA Dynamic Model Router Evaluator (Phase 2 P3)
 *
 * 依据 Prompt 复杂度、多模态 (Vision)、上下文 Token 长度及关键词意图，
 * 智能分流请求至 low / medium / high / reasoning 模型层级。
 */

const COMPLEX_KEYWORDS = ['refactor', 'architecture', 'debug', 'redesign', '重构', '架构', '报错', '死锁', '并发', '漏洞', '性能优化'];
const REASONING_KEYWORDS = ['证明', '深度推导', '数学建模', 'prover', 'formal verification', 'benchmark'];

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
  if (REASONING_KEYWORDS.some(kw => lowerText.includes(kw))) {
    return 'reasoning';
  }

  // 3. 包含复杂架构/重构/调试关键词 或 超长上下文 -> 高阶模型
  if (COMPLEX_KEYWORDS.some(kw => lowerText.includes(kw)) || totalTextLength >= mediumThreshold) {
    return 'high';
  }

  // 4. 中等上下文长度 -> 中阶模型
  if (totalTextLength > lowThreshold || input.length > 3) {
    return 'medium';
  }

  // 5. 短文本、简单单轮问答 -> 低成本模型
  return 'low';
}

export default function routerExtension(pi) {
  pi.on('before_provider_request', (event, ctx) => {
    const req = event?.req || event?.payload || {};
    const targetModel = evaluateModelRoute(req);

    if (event?.req) {
      event.req.model = targetModel;
    }
    if (event?.payload) {
      event.payload.model = targetModel;
    }

    return { ...req, model: targetModel };
  });
}
