import { runBatchOptimization } from '../src/optimizer.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
import { isExtensionEnabled } from '../src/extension-profile.js';

export default function optimizerExtension(pi) {
  if (!isExtensionEnabled('optimizer')) return;
  pi.registerTool({
    name: 'trigger_batch_optimization',
    description:
      'Trigger the L7 offline batch optimizer to reflect on trajectories and update project rules',
    parameters: { type: 'object', properties: {} },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const res = runBatchOptimization({ cwd: ctx?.cwd });
      return { ...res, content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    },
  });
}
