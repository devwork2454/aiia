/**
 * AIIA Autonomous Router Extension
 * Injects a global directive to empower the Main Agent to proactively use Subagents
 * for complex tasks, effectively transforming it into an autonomous dispatcher.
 */

import { isExtensionEnabled } from '../src/extension-profile.js';

export default function autoRouterExtension(pi) {
  if (!isExtensionEnabled('auto-router')) return;
  pi.on('context', async (event) => {
    const messages = event?.messages ?? [];
    if (!messages.length) return;

    if (process.env.AIIA_DISABLE_AUTO_ROUTER === '1') return;

    const routerDirective = `
=========================================
[AIIA Autonomous Router Engine Active]
You are running as the Master Dispatcher in an Infinite-Context Autonomous Architecture.
CRITICAL BEHAVIORAL RULE:
If the user requests a complex engineering task (e.g., refactor a module, build a new feature, or heavy analysis):
1. Do NOT execute the raw steps directly in this main thread. Doing so risks polluting your Master Context.
2. PROACTIVELY decompose the task into a Directed Acyclic Graph (DAG) for maximum concurrency and independence.
3. Use the \`execute_dag\` tool to delegate the entire execution graph to isolated subagent threads. The system will handle the dependencies and merge the context for you.
4. You are the Architect. Protect your context. Delegate complexity.
=========================================
`;

    // Ensure we mutate a copy so we don't accidentally freeze the original reference
    const newMessages = [...messages];
    const systemMsgIndex = newMessages.findIndex((m) => m.role === 'system');

    if (systemMsgIndex !== -1) {
      newMessages[systemMsgIndex] = {
        ...newMessages[systemMsgIndex],
        content: `${newMessages[systemMsgIndex].content}\n\n${routerDirective}`,
      };
    } else {
      newMessages.unshift({
        role: 'system',
        content: routerDirective,
      });
    }

    return { messages: newMessages };
  });
}
