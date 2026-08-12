import { intro, outro, spinner } from '@clack/prompts';
import { InteractivePrompt } from './prompt.js';

async function main() {
  intro('🤖 AIIA CLI (MVP) - Interactive Prompt with @ completion');

  const prompt = new InteractivePrompt();
  let isRunning = true;

  while (isRunning) {
    const userInput = await prompt.ask('\x1b[32m?\x1b[0m You (type exit to quit):');

    if (!userInput || userInput.trim().toLowerCase() === 'exit') {
      outro('Goodbye! Agent session detached.');
      isRunning = false;
      break;
    }

    if (!userInput.trim()) continue;

    const s = spinner();
    s.start('Agent thinking and executing tools...');

    try {
      // 模拟等待后端/Pi 处理
      await new Promise(r => setTimeout(r, 1000));
      s.stop('Agent finished');
      console.log(`\n\x1b[34m[Agent]\x1b[0m: Echoing back -> "${userInput}"\n`);
    } catch (error) {
      s.stop('Error occurred');
      console.error(error);
    }
  }
}

main().catch(console.error);
