/**
 * AIIA Context GC Extension (JVM Generational GC inspired)
 * Dynamically folds old process context into summarized Survivor memories.
 */

const GC_THRESHOLD = 25; // Trigger GC if messages exceed this count
const GC_KEEP_RECENT = 10; // Number of recent messages to keep in Eden

function findSafeCutoffIndex(messages, targetIndex) {
  // Find a safe message to cut off at (must not split tool_calls and tool_results)
  // We walk backward from targetIndex.
  for (let i = targetIndex; i > 1; i--) {
    const msg = messages[i];
    // Safe boundary: a user message or an assistant message without tool_calls
    if (msg.role === 'user') return i;
    if (msg.role === 'assistant' && (!msg.tool_calls || msg.tool_calls.length === 0)) return i;
  }
  return -1; // No safe cutoff found
}

async function summarizeWithLLM(messagesToSummarize, ctx) {
  // Try to use the active model's base URL and provider to summarize.
  // We use the same model by default, or append -flash if it's a known fast tier.
  const baseUrl = ctx?.model?.baseUrl || 'http://127.0.0.1:4000/v1';
  const modelId = ctx?.model?.id || 'high';
  
  // Create a payload for the LLM
  const payload = {
    model: modelId,
    messages: [
      { role: 'system', content: 'You are an AI Context GC module. Summarize the following execution process, tool calls, and results into a highly condensed single-paragraph state update. Focus ONLY on final outcomes, critical errors resolved, and facts discovered. Do NOT output markdown formatting like JSON blocks, just pure text.' },
      { role: 'user', content: JSON.stringify(messagesToSummarize) }
    ],
    max_tokens: 500,
    temperature: 0.1
  };

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY || 'dummy'}`
      },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      const data = await res.json();
      return data?.choices?.[0]?.message?.content || '[GC Summarization empty]';
    } else {
      console.error('[AIIA Context GC] Summarization API failed with status:', res.status);
      return null;
    }
  } catch (err) {
    console.error('[AIIA Context GC] Summarization fetch failed:', err.message);
    return null;
  }
}

export default function contextGCExtension(pi) {
  pi.on('before_provider_request', async (event, ctx) => {
    const req = event?.req || event?.payload;
    if (!req || !req.messages || !Array.isArray(req.messages)) return;
    
    if (req.messages.length > GC_THRESHOLD && process.env.AIIA_DISABLE_GC !== '1') {
      const cutoff = findSafeCutoffIndex(req.messages, req.messages.length - GC_KEEP_RECENT);
      
      if (cutoff > 1) {
        const messagesToSummarize = req.messages.slice(1, cutoff + 1);
        
        console.log(`[AIIA Context GC] Triggered Minor GC! Compacting ${messagesToSummarize.length} messages (Eden -> Survivor).`);
        
        let summaryText = await summarizeWithLLM(messagesToSummarize, ctx);
        
        if (!summaryText) {
          // Fallback to structural truncation if LLM fails
          summaryText = `[Heuristic GC Truncation]\n${messagesToSummarize.length} intermediate turns were folded to prevent context bloat.`;
        }

        const survivorMessage = {
          role: 'assistant',
          content: `[AIIA GC Survivor Memory] 过去几轮执行的微小结：\n${summaryText}`
        };

        // Mutate req.messages: Keep [0] (System), add Survivor, keep [cutoff + 1 ... end]
        req.messages = [
          req.messages[0],
          survivorMessage,
          ...req.messages.slice(cutoff + 1)
        ];
        
        console.log(`[AIIA Context GC] Context array compressed from ${req.messages.length + messagesToSummarize.length - 1} to ${req.messages.length}.`);
      }
    }
  });
}
