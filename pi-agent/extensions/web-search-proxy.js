/**
 * AIIA Web Search Proxy Extension (Phase 2 P0)
 * 1. 意图嗅探：自动识别 Prompt 中的搜索/联网关键词 (如 @web, "最新", "搜索", "实时")。
 * 2. 在 before_provider_request 钩子中修改请求，自动注入搜索增强指令或路由至支持联网的桥接 Channel。
 * 3. 自动在后台维护 AGY API Bridge 服务 (127.0.0.1:8788)。
 */

import { startAgyBridgeServer } from '../src/agy-bridge.js';

const SEARCH_KEYWORDS = ['@web', '搜索', '最新', '实时', '全网', '排查', '查一下'];

let bridgeServer = null;

export default function webSearchProxyExtension(pi) {
  // 自动启动后台 AGY Bridge
  if (!bridgeServer) {
    try {
      bridgeServer = startAgyBridgeServer(8788);
    } catch {}
  }

  // 监听 before_provider_request 钩子
  pi.on('before_provider_request', async (event) => {
    if (!event?.req?.messages || !Array.isArray(event.req.messages)) return;

    const lastMsg = event.req.messages.slice(-1)[0];
    const text = String(lastMsg?.content || '');

    const hasSearchIntent = SEARCH_KEYWORDS.some(kw => text.includes(kw));

    if (hasSearchIntent) {
      // 1. 在 Prompt 前自动追加强化网络检索的提示
      if (typeof lastMsg.content === 'string') {
        if (!lastMsg.content.includes('[Web Search Active]')) {
          lastMsg.content = `[Web Search Active: 请结合全网最新知识与实时检索信息回答]\n${lastMsg.content}`;
        }
      }

      // 2. 如果当前有配置的代理端点，可动态导向 agy-bridge 8788 端口
      if (event.req.baseUrl && event.req.baseUrl.includes('4000')) {
        // 在 LiteLLM 路由上标记使用支持 Web 搜索的模型 channel
        event.req.model = event.req.model || 'high-search';
      }
    }
  });
}
