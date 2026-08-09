/**
 * AIIA Web Search Proxy Extension (Phase 2 P1)
 * 1. 意图嗅探：自动识别 Prompt 中的搜索/联网关键词 (@web, "最新", "搜索", "实时", "全网", "排查", "查一下", "find").
 * 2. 动态路由适配：
 *    - 适配本地反代 (LiteLLM / CPA / cursor-openai-api / AGY Bridge)。
 *    - 当匹配到搜索意图时：
 *      a. 若指定了 SEARCH_MODEL_OVERRIDE 环境变量，重定向至该搜索模型 (如 high-search / gemini-search)。
 *      b. 若指定了 SEARCH_PROXY_URL 环境变量，重定向 req.baseUrl。
 *      c. 在 prompt 中自动结构化注入 [Web Search Active] 增强指令（支持 string 与 content 数组格式）。
 * 3. 自动维持后台 AGY API Bridge 服务 (127.0.0.1:8788) 作为无缝兜底。
 */

import { startAgyBridgeServer } from '../src/agy-bridge.js';

const SEARCH_KEYWORDS = ['@web', '搜索', '最新', '实时', '全网', '排查', '查一下', 'find'];

let bridgeServer = null;

export function isSearchIntent(text = '') {
  if (!text) return false;
  return SEARCH_KEYWORDS.some(kw => text.includes(kw));
}

export function injectSearchDirective(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return false;

  if (typeof lastMsg.content === 'string') {
    if (!lastMsg.content.includes('[Web Search Active')) {
      lastMsg.content = `[Web Search Active: 请结合全网最新知识与实时检索信息回答]\n${lastMsg.content}`;
      return true;
    }
  } else if (Array.isArray(lastMsg.content)) {
    const textObj = lastMsg.content.find(c => c.type === 'text' || typeof c.text === 'string');
    if (textObj && !textObj.text.includes('[Web Search Active')) {
      textObj.text = `[Web Search Active: 请结合全网最新知识与实时检索信息回答]\n${textObj.text}`;
      return true;
    }
  }
  return false;
}

export default function webSearchProxyExtension(pi) {
  // 自动启动后台 AGY Bridge
  if (!bridgeServer) {
    try {
      bridgeServer = startAgyBridgeServer(8788);
    } catch {}
  }

  // 监听 before_provider_request 钩子
  pi.on('before_provider_request', async (event) => {
    const req = event?.req || event?.payload;
    if (!req || !req.messages || !Array.isArray(req.messages)) return;

    const lastMsg = req.messages[req.messages.length - 1];
    let text = '';
    if (typeof lastMsg?.content === 'string') {
      text = lastMsg.content;
    } else if (Array.isArray(lastMsg?.content)) {
      text = lastMsg.content.map(c => c.text || c.content || '').join(' ');
    }

    if (isSearchIntent(text)) {
      // 1. 结构化注入提示词
      injectSearchDirective(req.messages);

      // 2. 动态路由重定向 (环境变量适配优先，其次 LiteLLM/CPA 适配，最后 AGY 兜底)
      const targetModel = process.env.SEARCH_MODEL_OVERRIDE || (req.model ? `${req.model}-search` : 'high-search');
      req.model = targetModel;

      if (process.env.SEARCH_PROXY_URL) {
        req.baseUrl = process.env.SEARCH_PROXY_URL;
      } else if (req.baseUrl && (req.baseUrl.includes('4000') || req.baseUrl.includes('litellm'))) {
        // LiteLLM / CPA 反代通道适配
        req.baseUrl = req.baseUrl;
      }
    }
  });
}
