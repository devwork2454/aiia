import fs from 'fs';
import path from 'path';
import { isExtensionEnabled } from '../src/extension-profile.js';

export default function largeFileGateExtension(pi) {
  if (!isExtensionEnabled('large-file-gate')) return;

  pi.on('tool_call', (event, ctx) => {
    const toolName = event?.toolName || event?.tool || event?.name || '';
    if (toolName !== 'view_file') return;

    const input = event?.input || event?.args || {};
    // If agent is already using pagination/slicing, let it pass
    if (input.StartLine || input.EndLine || input.ContentOffset) return;

    const targetFile = input.AbsolutePath || input.path || input.TargetFile;
    if (!targetFile) return;

    try {
      if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) return;

      const stats = fs.statSync(targetFile);
      if (stats.size > 30 * 1024) {
        const content = fs.readFileSync(targetFile, 'utf8');
        const lines = content.split('\n').length;
        if (lines > 500) {
          return {
            block: true,
            reason: `❌ [Large File Gate] 目标文件过大 (${lines} 行)。根据 AGENTS.md 规范，禁止全量读取大于 500 行的文档或代码文件。请改用 semantic_search 语义检索，或指定 StartLine 和 EndLine 局部读取。`,
            terminate: false,
          };
        }
      }
    } catch {
      // ignore
    }
  });
}
