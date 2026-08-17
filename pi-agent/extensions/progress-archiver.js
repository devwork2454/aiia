import fs from 'fs';
import path from 'path';
import { isExtensionEnabled } from '../src/extension-profile.js';

export default function progressArchiverExtension(pi) {
  if (!isExtensionEnabled('progress-archiver')) return;

  pi.on('session_shutdown', (event, ctx) => {
    if (process.env.AIIA_DISABLE_PROGRESS_ARCHIVE === '1') return;
    const cwd = ctx?.cwd || process.cwd();
    const progressFile = path.join(cwd, 'PROGRESS.md');
    const archiveFile = path.join(cwd, 'PROGRESS_ARCHIVE.md');

    if (!fs.existsSync(progressFile)) return;

    try {
      const content = fs.readFileSync(progressFile, 'utf8');
      const lines = content.split('\n');
      if (lines.length <= 300) return;

      // Auto-archive completed tasks heuristically
      const completedRegex = /^[ \t]*-[ \t]*\[[xX]\]/i;
      const keepLines = [];
      const archiveLines = [];

      let inCompletedSection = false;
      for (const line of lines) {
        if (completedRegex.test(line)) {
          archiveLines.push(line);
          inCompletedSection = true;
        } else if (inCompletedSection && line.trim().startsWith('- ')) {
          // A new uncompleted item breaks the completed block
          keepLines.push(line);
          inCompletedSection = false;
        } else if (inCompletedSection && line.trim() === '') {
          archiveLines.push(line);
        } else {
          keepLines.push(line);
          inCompletedSection = false;
        }
      }

      if (archiveLines.length > 20) {
        fs.writeFileSync(progressFile, keepLines.join('\n'));
        const stamp = new Date().toISOString().slice(0, 10);
        fs.appendFileSync(
          archiveFile,
          `\n## Archived on ${stamp}\n` + archiveLines.join('\n') + '\n',
        );
      }
    } catch {
      // ignore
    }
  });
}
