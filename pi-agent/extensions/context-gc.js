/**
 * AIIA Context GC Extension (JVM Generational GC inspired)
 * Dynamically folds old process context into summarized Survivor memories.
 */

const GC_TOKEN_THRESHOLD = 8000; // Trigger GC if approximate tokens exceed this
const GC_KEEP_RECENT = 10; // Number of recent messages to keep in Eden

import fs from 'node:fs';
import path from 'node:path';

function logError(cwd, prefix, errMessage) {
  try {
    const logPath = path.join(cwd || process.cwd(), '.agent', 'error.log');
    const time = new Date().toISOString();
    fs.appendFileSync(logPath, `[${time}] ${prefix}: ${errMessage}\n`);
  } catch (e) {}
}

function estimateTokens(messages) {
  let totalLength = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalLength += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          totalLength += part.text.length;
        }
      }
    }
    if (msg.tool_calls) {
      totalLength += JSON.stringify(msg.tool_calls).length;
    }
  }
  return Math.ceil(totalLength / 4);
}

function findSafeCutoffIndex(messages, targetIndex) {
  // Find a safe message to cut off at (must not split tool_calls and tool_results)
  // We walk backward from targetIndex.
  for (let i = targetIndex; i > 1; i--) {
    const msg = messages[i];
    // Safe boundary: a user message, an assistant message without tool_calls, or a tool result
    if (msg.role === 'user') return i;
    if (msg.role === 'tool') return i;
    if (msg.role === 'assistant' && (!msg.tool_calls || msg.tool_calls.length === 0)) return i;
  }
  return -1; // No safe cutoff found
}

async function summarizeWithLLM(messagesToSummarize, ctx) {
  // Try to use the active model's base URL and provider to summarize.
  const baseUrl = ctx?.model?.baseUrl || 'http://127.0.0.1:4000/v1';
  const modelId = ctx?.model?.id || 'high';
  
  // Create a payload for the LLM
  const payload = {
    model: modelId,
    messages: [
      { 
        role: 'system', 
        content: `You are an AI Context GC module. Summarize the following execution process, tool calls, and results into a condensed state update. \nCRITICAL RULE (Lossless Entity Extraction): You MUST extract and retain all absolute file paths, configuration keys, environment variables, git commits, and precise error codes/messages. \nDo NOT output markdown formatting like JSON blocks, just pure text, but ensure technical entities are preserved perfectly.`
      },
      { role: 'user', content: JSON.stringify(messagesToSummarize) }
    ],
    max_tokens: 800,
    temperature: 0.1
  };

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ctx?.model?.apiKey || ctx?.model?.key || process.env.OPENAI_API_KEY || 'dummy'}`
      },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      const data = await res.json();
      return data?.choices?.[0]?.message?.content || '[GC Summarization empty]';
    } else {
      const errMessage = `status ${res.status}`;
      console.debug(`[AIIA Context GC] Summarization API skipped (${errMessage}). Using fallback heuristic.`);
      logError(ctx?.cwd, '[AIIA Context GC]', `Summarization API skipped - ${errMessage}`);
      return null;
    }
  } catch (err) {
    console.debug(`[AIIA Context GC] Summarization fetch skipped (${err.message}). Using fallback heuristic.`);
    logError(ctx?.cwd, '[AIIA Context GC]', `Summarization fetch failed - ${err.message}`);
    return null;
  }
}

export default function contextGCExtension(pi) {
  pi.on('before_provider_request', async (event, ctx) => {
    const req = event?.req || event?.payload;
    if (!req || !req.messages || !Array.isArray(req.messages)) return;
    
    if (process.env.AIIA_DISABLE_GC === '1') return;

    const currentTokens = estimateTokens(req.messages);
    
    // We also keep a fallback message count threshold to prevent array bloat
    if (currentTokens > GC_TOKEN_THRESHOLD || req.messages.length > 40) {
      const targetIndex = Math.max(1, req.messages.length - GC_KEEP_RECENT);
      const cutoff = findSafeCutoffIndex(req.messages, targetIndex);
      
      if (cutoff > 1) {
        const messagesToSummarize = req.messages.slice(1, cutoff + 1);
        
        console.log(`[AIIA Context GC] Triggered Minor GC! Tokens ~${currentTokens} > ${GC_TOKEN_THRESHOLD}. Compacting ${messagesToSummarize.length} messages (Eden -> Survivor).`);
        
        let summaryText = await summarizeWithLLM(messagesToSummarize, ctx);
        
        if (!summaryText) {
          // Fallback to structural truncation if LLM fails
          summaryText = `[Heuristic GC Truncation]\n${messagesToSummarize.length} intermediate turns were folded to prevent context bloat.`;
        }

        const survivorMessage = {
          role: 'assistant',
          content: `[AIIA GC Survivor Memory] 过去几轮执行的微小结与核心实体提取：\n${summaryText}`
        };

        // Mutate req.messages: Keep [0] (System), add Survivor, keep [cutoff + 1 ... end]
        req.messages = [
          req.messages[0],
          survivorMessage,
          ...req.messages.slice(cutoff + 1)
        ];
        
        console.log(`[AIIA Context GC] Context compressed. Old msg count: ${req.messages.length + messagesToSummarize.length - 1}, New msg count: ${req.messages.length}.`);
      }
    }
  });
}
