/**
 * 飞书遥控结果回传 (Lark Remote Progress Sync)
 * 配合 src/lark-daemon.js 使用：Pi 引擎执行完语音/文本任务后，
 * 通过 message_end 捕获最后一段 assistant 回答，session_shutdown 时
 * 仅向飞书回复一张绿色结果卡片（含实际回答，超 8000 字符截断）。
 * 不推送实时进度卡片，避免刷屏。
 */
import { execFileSync } from 'child_process';

// 最终结果只发送一张卡片（不推送实时进度卡片，避免刷屏）
function sendFinalCard(messageId, taskDesc, finalText) {
  const MAX_LEN = 8000;
  const content = (finalText || '').trim();
  let body;
  if (!content) {
    body = '✅ 任务执行完毕';
  } else if (content.length > MAX_LEN) {
    body = `${content.slice(0, MAX_LEN)}\n\n…（内容过长已截断）`;
  } else {
    body = content;
  }
  const cardJson = JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '[Pi Agent] 任务完成 ✔' },
      template: 'green',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**🎯 目标：** ${taskDesc}\n━━━━━━━━━━━━━━━━━━\n${body}`,
        },
      },
    ],
  });
  try {
    execFileSync(
      'lark-cli',
      [
        'im',
        '+messages-reply',
        '--message-id',
        messageId,
        '--msg-type',
        'interactive',
        '--content',
        cardJson,
        '--as',
        'bot',
      ],
      { encoding: 'utf-8' },
    );
    console.log('[lark-progress-sync] Final card sent');
  } catch (err) {
    console.debug('[lark-progress-sync] Final card error:', err.message);
  }
}

export default function larkProgressSyncExtension(pi) {
  const messageId = process.env.LARK_REPLY_MESSAGE_ID;
  const taskDesc = process.env.LARK_TASK_DESC || '执行 Pi 任务';

  if (!messageId) return;

  let assistantText = '';

  // Capture assistant response text（Pi 扩展事件为 message_end，兼容 content 数组/字符串；只保留最后一段，避免中间问候语混入）
  pi.on('message_end', (event) => {
    const msg = event.message || event;
    if (msg.role !== 'assistant') return;
    const content = msg.content;
    let text = '';
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object' && block.type === 'text' && block.text) {
          text += block.text;
        }
      }
    } else if (typeof content === 'string') {
      text = content;
    }
    if (text) assistantText = text;
  });

  pi.on('session_shutdown', async () => {
    // 只发送一张最终结果卡片（代替：完成卡片 + 独立 Markdown 回复）
    sendFinalCard(messageId, taskDesc, assistantText);
  });
}
