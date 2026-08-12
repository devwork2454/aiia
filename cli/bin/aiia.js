#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the absolute path to the JSX entry point
const indexFile = join(__dirname, '../index.jsx');

// Use npx tsx to execute the React/Ink entry point
// We use spawnSync to keep the process attached to the current TTY
const result = spawnSync('npx', ['tsx', indexFile], {
  stdio: 'inherit',
});

if (result.error) {
  console.error('[AIIA CLI] Failed to start:', result.error.message);
  process.exit(1);
}

process.exit(result.status || 0);
