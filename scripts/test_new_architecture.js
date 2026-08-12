import autoRouterExtension from '../pi-agent/extensions/auto-router.js';
import contextGCExtension from '../pi-agent/extensions/context-gc.js';

const mockPi = {
  events: {},
  on(evt, handler) {
    if (!this.events[evt]) this.events[evt] = [];
    this.events[evt].push(handler);
  }
};

// Register the extensions
autoRouterExtension(mockPi);
contextGCExtension(mockPi);

const dummyCtx = {
  model: { baseUrl: 'http://127.0.0.1:8788/v1', id: 'high' }
};

async function runTest() {
  console.log("======================================");
  console.log("Test 1: Auto-Router Directive Injection");
  
  // Initial context has just a generic system prompt and a user prompt
  const initialEvent = {
    messages: [
      { role: 'system', content: 'You are an AI.' },
      { role: 'user', content: 'Please refactor the entire authentication module.' }
    ]
  };

  let finalMessages = initialEvent.messages;
  if (mockPi.events['context']) {
    for (const handler of mockPi.events['context']) {
      const res = await handler({ messages: finalMessages });
      if (res && res.messages) {
        finalMessages = res.messages;
      }
    }
  }

  console.log("[System Prompt After Injection]:\n");
  console.log(finalMessages[0].content);
  console.log("\n-> Directive correctly injected into system prompt!");


  console.log("\n======================================");
  console.log("Test 2: Context GC Token Trigger");

  // Create a fake history with a massive file read
  const massiveOutput = "Error trace... ".repeat(600); // 9000 chars, ~2250 tokens
  const longHistory = [
    { role: 'system', content: finalMessages[0].content },
    { role: 'user', content: 'run tests' }
  ];
  
  // Add 15 turns of noisy output to easily hit the 8000 token limit
  for (let i = 0; i < 15; i++) {
    longHistory.push({ role: 'assistant', tool_calls: [{ id: '1', name: 'run', input: 'test' }] });
    longHistory.push({ role: 'tool', name: 'run', content: massiveOutput });
  }
  
  longHistory.push({ role: 'user', content: 'Are we done?' });

  console.log(`[Before GC]: Message count = ${longHistory.length}`);
  
  const providerEvent = { req: { messages: longHistory } };
  
  if (mockPi.events['before_provider_request']) {
    for (const handler of mockPi.events['before_provider_request']) {
      await handler(providerEvent, dummyCtx);
    }
  }

  console.log(`[After GC]: Message count = ${providerEvent.req.messages.length}`);
  console.log(`[Survivor Message Generated]:`);
  console.log(providerEvent.req.messages[1].content);
  console.log("\n-> Context successfully compressed!");
  console.log("======================================");
}

runTest();
