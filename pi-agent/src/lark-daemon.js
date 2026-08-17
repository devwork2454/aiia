import { spawn, execSync, execFileSync } from 'child_process';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * 飞书机器人 Daemon (Lark Remote Control Daemon)
 * 职责：
 * 1. 监听飞书 `im.message.receive_v1` 事件（systemd user 服务 aiia-remote，`pi remote` 管理）。
 * 2. 收到消息先在原消息上贴“了解”(Get) 表情确认，不单独回表情消息。
 * 3. 语音消息：下载音频 → SenseVoice STT (127.0.0.1:8001) → 识别文本作为 prompt。
 * 4. 文本/语音内容统一作为 prompt 拉起 `pi -p` 处理，执行期间不发进度卡片。
 * 5. 最终结果由 lark-progress-sync 扩展以一张结果卡片返回（含实际回答）。
 */

const LARK_CLI = 'lark-cli';

// 卡片模板
function generateProgressCard(taskDesc, progressStr, status) {
  let color = 'blue';
  if (status === 'completed') color = 'green';
  if (status === 'error') color = 'red';

  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: 'plain_text',
        content: `[Pi Agent] ${status === 'completed' ? '任务完成 ✔' : '任务执行中 🚀'}`,
      },
      template: color,
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**🎯 目标：** ${taskDesc}\n━━━━━━━━━━━━━━━━━━\n**实时进度：**\n${progressStr}`,
        },
      },
    ],
  });
}

function replyWithCard(messageId, taskDesc, progressStr, status = 'running') {
  const cardJson = generateProgressCard(taskDesc, progressStr, status);
  // lark-cli im +messages-reply --message-id <id> --msg-type interactive --content <card_json> --as bot
  try {
    execFileSync(
      LARK_CLI,
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
      { encoding: 'utf-8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    console.log(`[Daemon] Sent card reply for ${messageId}`);
  } catch (err) {
    console.error(`[Daemon] Failed to send card: ${err.stderr || err.message}`);
  }
}

// 收到消息：在消息上使用表情回复（reaction 贴纸），不单独回复一条表情消息
function replyWithReaction(messageId, emojiType = 'Get') {
  try {
    execFileSync(
      LARK_CLI,
      [
        'im',
        'reactions',
        'create',
        '--message-id',
        messageId,
        '--data',
        JSON.stringify({ reaction_type: { emoji_type: emojiType } }),
        '--as',
        'bot',
      ],
      { encoding: 'utf-8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    console.log(`[Daemon] Sent reaction ${emojiType} for ${messageId}`);
  } catch (err) {
    console.error(`[Daemon] Failed to send reaction: ${err.stderr || err.message}`);
  }
}

// 从语音消息 content 中解析 file_key，兼容 JSON / XML-like / 裸 key 三种格式
function extractAudioFileKey(content) {
  if (!content) return '';
  // 1) JSON 格式: {"file_key": "..."}
  try {
    const obj = JSON.parse(content);
    return obj.file_key || obj.audio_key || obj.key || '';
  } catch (e) {
    console.debug('[lark-daemon] JSON parse ignored:', e.message);
  }
  // 2) XML-like 格式: <audio key="file_v3_xxx" duration="..." />
  let m = content.match(/(?:file_key|audio_key|key)="([^"]+)"/);
  if (m) return m[1];
  // 3) 裸 key 格式
  m = content.match(/(file_v3_[A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return '';
}

function downloadAudio(messageId, fileKey) {
  try {
    console.log(`[Daemon] Downloading audio ${fileKey} for message ${messageId}...`);
    // lark-cli --output 仅接受相对路径（拒绝绝对路径与 ..），故传 cwd 相对路径
    const relDir = 'lark-im-resources';
    const relPath = `${relDir}/${messageId}.audio`;
    fs.mkdirSync(path.join(process.cwd(), relDir), { recursive: true });
    execFileSync(
      LARK_CLI,
      [
        'im',
        '+messages-resources-download',
        '--message-id',
        messageId,
        '--file-key',
        fileKey,
        '--type',
        'file',
        '--output',
        relPath,
        '--as',
        'bot',
      ],
      { encoding: 'utf-8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const outPath = path.join(process.cwd(), relPath);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      console.log(`[Daemon] Audio saved: ${outPath} (${fs.statSync(outPath).size} bytes)`);
      return outPath;
    }
    console.error(`[Daemon] Downloaded file missing/empty: ${outPath}`);
    return null;
  } catch (err) {
    console.error(`[Daemon] Failed to download audio: ${err.stderr || err.message}`);
    return null;
  }
}

async function handleIncomingMessage(msg) {
  // `lark-cli event consume` emits a flattened NDJSON format
  if (msg.type !== 'im.message.receive_v1') return;
  const messageId = msg.message_id || msg.id;
  const msgType = msg.message_type;
  if (!messageId) return;

  let taskDesc = '';

  if (msgType === 'text') {
    // 收到消息：在消息上贴“了解”表情确认收到（不额外发卡片/消息）
    replyWithReaction(messageId, 'Get');
    try {
      const contentObj = JSON.parse(msg.content);
      taskDesc = contentObj.text;
    } catch (_e) {
      taskDesc = msg.content;
    }
    console.log(`[Daemon] Received Text: ${taskDesc}`);
  } else if (msgType === 'audio') {
    console.log(`[Daemon] Received Audio Message!`);
    // 收到语音：在消息上贴“了解”表情确认收到，不再发进度卡片（最终只返回一张结果卡片）
    replyWithReaction(messageId, 'Get');

    try {
      const fileKey = extractAudioFileKey(msg.content);

      if (!fileKey) {
        taskDesc = '(未解析出音频 file_key)';
        console.error(`[Daemon] Cannot find file_key in: ${msg.content}`);
      } else {
        const audioPath = downloadAudio(messageId, fileKey);
        if (audioPath) {
          console.log(`[Daemon] Sending audio to STT Server: ${audioPath}`);
          try {
            const sttResBuffer = execFileSync(
              'curl',
              ['-s', '-X', 'POST', '-F', `file=@${audioPath}`, 'http://127.0.0.1:8001/transcribe'],
              { encoding: 'utf-8', timeout: 120_000 },
            );
            const json = JSON.parse(sttResBuffer);
            taskDesc = json.text || '(未听清内容)';
            console.log(`[Daemon] STT Result: ${taskDesc}`);
          } catch (curlErr) {
            console.error(`[Daemon] STT Server call failed: ${curlErr.message}`);
            taskDesc = `(语音识别服务不可用)`;
          }
        } else {
          taskDesc = '(语音下载失败)';
        }
      }
    } catch (_e) {
      taskDesc = '(处理语音发生异常)';
      console.error(_e);
    }
  } else {
    console.log(`[Daemon] Ignored message type: ${msgType}`);
    return;
  }

  if (taskDesc.startsWith('(')) {
    replyWithCard(messageId, taskDesc, '⚠️ 任务创建失败', 'error');
    return;
  }

  // 开始执行 Pi 任务：不再发送进度卡片，执行结果由 lark-progress-sync 以一张卡片返回

  // 真实拉起后台 Pi 进程
  console.log(`[Daemon] Spawning Pi Engine for message ${messageId}...`);
  const piChild = spawn('npx', ['pi', '-p', taskDesc], {
    env: {
      ...process.env,
      AIIA_EXTENSIONS: 'all',
      LARK_REPLY_MESSAGE_ID: messageId,
      LARK_TASK_DESC: taskDesc,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let outputRaw = '';
  piChild.stdout.on('data', (data) => {
    outputRaw += data.toString();
  });

  piChild.on('close', (code) => {
    // 最终结果由 lark-progress-sync 的 session_shutdown 以一张卡片发送，避免重复回复
    console.log(`[Daemon] Pi Engine exited with code ${code} for ${messageId}`);
  });

  piChild.unref();
}

function startListening() {
  console.log('[Daemon] Starting Lark Event Listener...');

  // 启动 lark-cli event consume
  const child = spawn(LARK_CLI, ['event', 'consume', 'im.message.receive_v1', '--as', 'bot']);

  const rl = readline.createInterface({
    input: child.stdout,
    terminal: false,
  });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const eventObj = JSON.parse(line);
      handleIncomingMessage(eventObj);
    } catch (e) {
      console.error(`[Daemon] Failed to parse event JSON: ${e.message}`);
    }
  });

  child.stderr.on('data', (data) => {
    const errStr = data.toString();
    if (errStr.includes('[event] ready')) {
      console.log('[Daemon] Successfully connected to Lark Event Bus.');
    } else {
      console.error(`[Lark CLI Stderr] ${errStr.trim()}`);
    }
  });

  child.on('close', (code) => {
    console.log(`[Daemon] Event Listener exited with code ${code}`);
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startListening();
}

export { startListening, handleIncomingMessage, extractAudioFileKey };
