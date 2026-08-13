import { runBatchOptimization } from '../src/optimizer.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function optimizerExtension(pi) {
  pi.registerTool({
    name: 'trigger_batch_optimization',
    description: 'Trigger the L7 offline batch optimizer to reflect on trajectories and update project rules',
    parameters: { type: 'object', properties: {} },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return runBatchOptimization({ cwd: ctx?.cwd });
    }
  });
}
