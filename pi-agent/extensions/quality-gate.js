/**
 * AIIA Quality Gate extension (S1)
 * After edit/write succeeds, run lint/typecheck and re-inject failures into tool_result.
 */
import { evaluateToolResultQuality } from '../src/quality-gate.js';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function qualityGateExtension(pi) {
  pi.on('tool_result', async (event, ctx) => {
    const cwd = ctx?.cwd || process.cwd();
    return evaluateToolResultQuality(event, { cwd });
  });
}
