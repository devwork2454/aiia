/**
 * AIIA Antigravity CLI (AGY) API Bridge Server
 * 将官方 agy CLI (Google DeepMind) 包装为标准的 OpenAI 兼容 API (/v1/chat/completions)。
 * 零配置，自动复用 ~/.gemini 下的登录凭据，物理层 100% 官方正规客户端请求，零封号风险。
 */

import http from 'http';
import { spawn } from 'child_process';
import readline from 'readline';

const PORT = process.env.AGY_BRIDGE_PORT || 8788;
const AGY_BIN = process.env.AGY_BIN_PATH || '/home/zakza/.local/bin/agy';

/** 从 OpenAI messages 数组拼接 prompt */
function extractPrompt(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  // 取最后一个 user 消息，附带之前的上下文 system 提示
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const lastUser = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
  if (system) {
    return `[System Context]\n${system}\n\n[User Prompt]\n${lastUser}`;
  }
  return lastUser;
}

/** 启动 HTTP Bridge */
export function startAgyBridgeServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    // 基础 CORS 支持
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // GET /v1/models 或 GET /health
    if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [
          { 
            id: 'agy-deepmind', 
            object: 'model', 
            created: Date.now(), 
            owned_by: 'google-deepmind',
            context_window: 2000000,
            max_tokens: 8192
          },
          { 
            id: 'antigravity-web', 
            object: 'model', 
            created: Date.now(), 
            owned_by: 'google-deepmind',
            context_window: 200000,
            max_tokens: 8192
          }
        ]
      }));
      return;
    }

    // POST /v1/chat/completions
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', () => {
        try {
          const body = JSON.parse(bodyStr || '{}');
          const prompt = extractPrompt(body.messages);
          const isStream = body.stream !== false; // 默认流式响应

          if (!prompt) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Empty prompt in messages array' } }));
            return;
          }

          // 核心：拉起官方 agy CLI 子进程
          const child = spawn(AGY_BIN, [
            '-p', prompt,
            '--output-format', 'stream-json',
            '--dangerously-skip-permissions'
          ], {
            env: { ...process.env },
            stdio: ['pipe', 'pipe', 'pipe']
          });

          const created = Math.floor(Date.now() / 1000);
          const chatId = `chatcmpl-agy-${Date.now()}`;

          if (isStream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });

            // 监听 stdout 逐行解析 agy JSONL
            const rl = readline.createInterface({ input: child.stdout });
            rl.on('line', line => {
              if (!line.trim()) return;
              try {
                const item = JSON.parse(line);
                const delta = item?.step_update?.text_delta;
                if (delta) {
                  const chunk = {
                    id: chatId,
                    object: 'chat.completion.chunk',
                    created,
                    model: body.model || 'agy-deepmind',
                    choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
                  };
                  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
              } catch {}
            });

            child.on('close', () => {
              const stopChunk = {
                id: chatId,
                object: 'chat.completion.chunk',
                created,
                model: body.model || 'agy-deepmind',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
              };
              res.write(`data: ${JSON.stringify(stopChunk)}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
            });
          } else {
            // 非流式，全量合并后返回
            let fullText = '';
            const rl = readline.createInterface({ input: child.stdout });
            rl.on('line', line => {
              try {
                const item = JSON.parse(line);
                const delta = item?.step_update?.text_delta;
                if (delta) fullText += delta;
              } catch {}
            });

            child.on('close', () => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                id: chatId,
                object: 'chat.completion',
                created,
                model: body.model || 'agy-deepmind',
                choices: [{ index: 0, message: { role: 'assistant', content: fullText }, finish_reason: 'stop' }]
              }));
            });
          }

          req.on('close', () => { child.kill(); });
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: e.message } }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not Found' } }));
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.warn(`[AIIA AGY Bridge] port ${port} already in use, reuse existing listener`);
      return;
    }
    console.error('[AIIA AGY Bridge] server error:', err);
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[AIIA AGY Bridge] Server running at http://127.0.0.1:${port}/v1`);
  });
  // 仅当非独立运行时才 unref (以便测试自然退出)
  if (import.meta.url !== `file://${process.argv[1]}`) {
    server.unref(); 
  }

  return server;
}

// 支持直接脚本独立运行
if (import.meta.url === `file://${process.argv[1]}`) {
  startAgyBridgeServer();
}
