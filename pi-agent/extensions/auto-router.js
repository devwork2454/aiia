/**
 * AIIA Autonomous Router Extension
 * Injects a global directive to empower the Main Agent to proactively use Subagents 
 * for complex tasks, effectively transforming it into an autonomous dispatcher.
 */

export default function autoRouterExtension(pi) {
  pi.on('context', async (event) => {
    const messages = event?.messages ?? [];
    if (!messages.length) return;

    if (process.env.AIIA_DISABLE_AUTO_ROUTER === '1') return;

    const routerDirective = `
=========================================
[AIIA Autonomous Router Engine Active]
You are running as the Master Dispatcher in an Infinite-Context Autonomous Architecture.
CRITICAL BEHAVIORAL RULE:
If the user requests a complex engineering task (e.g., refactor a module, build a new feature, or fix a deep bug):
1. Do NOT execute the raw file edits directly in this main thread. Doing so risks polluting your Master Context.
2. PROACTIVELY decompose the task and use \`spawn_worktree_subagent\` to delegate the dirty work to an isolated subagent thread.
3. Once the subagent finishes and reports back, verify its output and use \`merge_worktree_subagent\` to integrate the work.
4. You are the Architect. Protect your context. Delegate complexity.
=========================================
`;

    // Ensure we mutate a copy so we don't accidentally freeze the original reference
    const newMessages = [...messages];
    let systemMsgIndex = newMessages.findIndex(m => m.role === 'system');
    
    if (systemMsgIndex !== -1) {
      newMessages[systemMsgIndex] = {
        ...newMessages[systemMsgIndex],
        content: `${newMessages[systemMsgIndex].content}\n\n${routerDirective}`
      };
    } else {
      newMessages.unshift({
        role: 'system',
        content: routerDirective
      });
    }

    return { messages: newMessages };
  });
}
