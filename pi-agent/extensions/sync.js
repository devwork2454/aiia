import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

// ─── 常量 ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.config', 'aiia');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, '.credentials.json');
const SYNC_META_FILE = path.join(CONFIG_DIR, '.sync_meta.json');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// GitHub OAuth App Client ID（Device Flow，只需 Client ID）
const GITHUB_CLIENT_ID = process.env.AIIA_GITHUB_CLIENT_ID || 'Ov23lifLgXiZSFLXmvww';

const GIST_FILENAME = 'aiia_vault_e2ee.json';
const GIST_DESCRIPTION = 'AIIA E2EE Cloud Sync Vault';

// ─── 同步资源清单 ─────────────────────────────────────────────────────────────
// 所有需要加密同步的资源，key 为存入 payload 的字段名
const SYNC_TARGETS = [
  // ── 机密类（含敏感信息，必须加密） ──────────────────────────────────────
  {
    key: 'secrets_env',
    label: 'API Keys & 密钥环境变量',
    path: path.join(os.homedir(), '.secrets', 'env'),
    type: 'text',
    sensitive: true
  },
  {
    key: 'vault',
    label: 'AIIA 个人保险箱 (账号/身份/银行卡等)',
    path: path.join(CONFIG_DIR, 'vault.enc.json'),
    type: 'text',    // 本身已加密的 JSON，直接作为文本同步
    sensitive: true
  },

  // ── Pi 配置类 ────────────────────────────────────────────────────────────
  {
    key: 'pi_settings',
    label: 'Pi 全局设置',
    path: path.join(os.homedir(), '.pi', 'agent', 'settings.json'),
    type: 'json',
    sensitive: false
  },
  {
    key: 'pi_skills',
    label: 'Pi Skills 目录',
    path: path.join(os.homedir(), '.pi', 'agent', 'skills'),
    type: 'directory',   // 整个目录打包
    sensitive: false
  },

  // ── MCP 配置类（各主流 AI 工具的 MCP 配置） ────────────────────────────
  {
    key: 'mcp_gemini',
    label: 'Gemini/AGY MCP 配置',
    path: path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json'),
    type: 'json',
    sensitive: false
  },
  {
    key: 'mcp_claude',
    label: 'Claude MCP 配置',
    path: path.join(os.homedir(), '.claude', 'mcp.json'),
    type: 'json',
    sensitive: false
  },
  {
    key: 'mcp_opencode',
    label: 'OpenCode MCP 配置',
    path: path.join(os.homedir(), '.opencode', 'mcp-config.json'),
    type: 'json',
    sensitive: false
  },

  // ── AIIA 自身 ────────────────────────────────────────────────────────────
  {
    key: 'aiia_config',
    label: 'AIIA 全局配置',
    path: CONFIG_FILE,
    type: 'json',
    sensitive: false
  },
  {
    key: 'aiia_db',
    label: 'AIIA 跨项目记忆库',
    path: path.join(CONFIG_DIR, 'aiia.db'),
    type: 'binary',
    sensitive: false
  }
];


// AES-256-GCM 加密常量（OWASP 2023 推荐参数）
const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITERATIONS = 210000;
const KEY_LENGTH = 32;
const DIGEST = 'sha512';

// ─── 本地存储工具 ─────────────────────────────────────────────────────────────

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8')); }
  catch { return null; }
}

function saveCredentials(data) {
  ensureConfigDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function loadMeta() {
  if (!fs.existsSync(SYNC_META_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(SYNC_META_FILE, 'utf8')); }
  catch { return {}; }
}

function saveMeta(data) {
  ensureConfigDir();
  fs.writeFileSync(SYNC_META_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ─── 加密 / 解密 ──────────────────────────────────────────────────────────────

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
}

function encrypt(plaintext, password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  return {
    v: 1,
    ciphertext,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex')
  };
}

function decrypt(encryptedObj, password) {
  try {
    const salt = Buffer.from(encryptedObj.salt, 'hex');
    const iv = Buffer.from(encryptedObj.iv, 'hex');
    const authTag = Buffer.from(encryptedObj.authTag, 'hex');
    const key = deriveKey(password, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let plaintext = decipher.update(encryptedObj.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  } catch {
    throw new Error('解密失败，主密码可能错误，数据未被修改。');
  }
}

// ─── GitHub API ───────────────────────────────────────────────────────────────

async function githubFetch(url, options = {}, token = null) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'AIIA-Sync/1.0',
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  return res.json();
}

/**
 * GitHub Device Flow 授权
 * 返回 access_token 字符串
 */
async function deviceFlowLogin(ctx) {
  // Step 1: 请求设备码
  const codeRes = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'AIIA-Sync/1.0'
    },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'gist' })
  });

  if (!codeRes.ok) throw new Error('无法连接 GitHub，请检查网络连接。');
  const { device_code, user_code, verification_uri, expires_in, interval } = await codeRes.json();

  // Step 2: 展示授权信息（使用 Pi 的 notify，同时在终端打印清晰提示）
  const msg = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  🌐 请在浏览器打开：${verification_uri}\n  🔑 输入授权码：    ${user_code}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  ⏱  有效期 ${Math.floor(expires_in / 60)} 分钟，等待您完成授权...\n`;
  ctx.ui.notify(msg, 'info');

  // Step 3: 轮询等待授权完成
  const pollMs = (interval || 5) * 1000;
  const deadline = Date.now() + expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'AIIA-Sync/1.0'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });

    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      // 获取用户信息
      const user = await githubFetch('https://api.github.com/user', {}, tokenData.access_token);
      saveCredentials({
        token: tokenData.access_token,
        username: user.login,
        authorizedAt: new Date().toISOString()
      });
      return { token: tokenData.access_token, username: user.login };
    }

    if (tokenData.error === 'authorization_pending' || tokenData.error === 'slow_down') continue;
    throw new Error(`授权失败: ${tokenData.error_description || tokenData.error}`);
  }

  throw new Error('授权超时，请重新运行 /sync login。');
}

async function findOrCreateGist(token) {
  const gists = await githubFetch('https://api.github.com/gists?per_page=100', {}, token);
  const found = gists.find(g => g.description === GIST_DESCRIPTION);
  if (found) return found.id;

  const newGist = await githubFetch('https://api.github.com/gists', {
    method: 'POST',
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [GIST_FILENAME]: { content: '{}' } }
    })
  }, token);
  return newGist.id;
}

async function pushToGist(token, gistId, content) {
  await githubFetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } })
  }, token);
}

async function pullFromGist(token, gistId) {
  const gist = await githubFetch(`https://api.github.com/gists/${gistId}`, {}, token);
  const file = gist.files[GIST_FILENAME];
  if (!file || file.content === '{}') return null;
  return file.content;
}

// ─── Pi 命令注册 ──────────────────────────────────────────────────────────────

export default function (pi) {
  pi.registerCommand('sync', {
    description: '端到端加密云端账号同步 | 用法: /sync <login|push|pull|status>',
    handler: async (args, ctx) => {
      const action = (args || '').trim().split(/\s+/)[0] || 'help';

      // ── login ────────────────────────────────────────────────────────────
      if (action === 'login') {
        try {
          ctx.ui.notify('🔐 正在初始化 GitHub Device Flow 授权...', 'info');
          const { token, username } = await deviceFlowLogin(ctx);
          ctx.ui.notify(`✅ 授权成功！欢迎，${username}！`, 'info');

          // 首次登录设置主密码
          const creds = loadCredentials();
          if (!creds?.pwHash) {
            ctx.ui.notify('📝 请设置同步主密码（仅用于加密，不会上传到任何地方）', 'info');
            const pw1 = await ctx.ui.input('设置主密码（8位以上）:', '');
            if (!pw1 || pw1.length < 8) {
              ctx.ui.notify('❌ 主密码不能少于 8 个字符，请重新运行 /sync login。', 'error');
              return;
            }
            const pw2 = await ctx.ui.input('确认主密码:', '');
            if (pw1 !== pw2) {
              ctx.ui.notify('❌ 两次输入不一致，请重新运行 /sync login。', 'error');
              return;
            }
            // 只存 SHA-256 哈希用于本机校验，不存明文
            const pwHash = crypto.createHash('sha256').update(pw1).digest('hex');
            saveCredentials({ token, username, authorizedAt: new Date().toISOString(), pwHash, hasSetPassword: true });
            ctx.ui.notify('✅ 主密码设置成功！运行 /sync push 开始同步配置。', 'info');
          }
        } catch (e) {
          ctx.ui.notify(`❌ 登录失败: ${e.message}`, 'error');
        }
      }

      // ── push ─────────────────────────────────────────────────────────────
      else if (action === 'push') {
        const creds = loadCredentials();
        if (!creds?.token) {
          ctx.ui.notify('⚠️ 尚未登录，请先运行 /sync login', 'warning');
          return;
        }

        const password = await ctx.ui.input('🔒 输入主密码:', '');
        if (!password) return;

        // 校验主密码
        if (creds.pwHash) {
          const inputHash = crypto.createHash('sha256').update(password).digest('hex');
          if (inputHash !== creds.pwHash) {
            ctx.ui.notify('❌ 主密码错误，同步已取消。', 'error');
            return;
          }
        }

        ctx.ui.notify('🔒 正在本地加密配置 (AES-256-GCM)...', 'info');

        // 动态汇集所有同步资源
        const payload = { syncedAt: new Date().toISOString(), device: os.hostname(), files: {} };
        const collected = [];
        const skipped = [];

        for (const target of SYNC_TARGETS) {
          if (!fs.existsSync(target.path)) { skipped.push(target.label); continue; }
          try {
            if (target.type === 'directory') {
              // 打包整个目录为 { 相对路径: base64内容 } 的 map
              const dirMap = {};
              const walk = (dir, base) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                  const rel = base ? `${base}/${entry.name}` : entry.name;
                  const full = path.join(dir, entry.name);
                  if (entry.isDirectory()) walk(full, rel);
                  else dirMap[rel] = fs.readFileSync(full).toString('base64');
                }
              };
              walk(target.path, '');
              payload.files[target.key] = dirMap;
            } else if (target.type === 'binary') {
              payload.files[target.key] = fs.readFileSync(target.path).toString('base64');
            } else {
              payload.files[target.key] = fs.readFileSync(target.path, 'utf8');
            }
            collected.push(target.label);
          } catch (e) {
            skipped.push(`${target.label} (读取失败: ${e.message})`);
          }
        }

        if (collected.length === 0) {
          ctx.ui.notify('⚠️ 没有找到任何可同步的资源文件，请先创建配置。', 'warning');
          return;
        }
        ctx.ui.notify(`📦 已收集 ${collected.length} 项资源:\n  ✅ ${collected.join('\n  ✅ ')}${skipped.length ? '\n  ⏭  跳过: ' + skipped.join(', ') : ''}`, 'info');

        const encryptedStr = JSON.stringify(encrypt(JSON.stringify(payload), password));

        try {
          let meta = loadMeta();
          if (!meta.gistId) {
            ctx.ui.notify('☁️  首次同步，正在创建私有 Gist...', 'info');
            meta.gistId = await findOrCreateGist(creds.token);
            saveMeta(meta);
          }
          ctx.ui.notify('☁️  正在上传加密数据...', 'info');
          await pushToGist(creds.token, meta.gistId, encryptedStr);
          ctx.ui.notify(`✅ 同步成功！配置已安全上传（GitHub 只存密文，无法解读）。`, 'info');
        } catch (e) {
          ctx.ui.notify(`❌ 上传失败: ${e.message}`, 'error');
        }
      }

      // ── pull ─────────────────────────────────────────────────────────────
      else if (action === 'pull') {
        const creds = loadCredentials();
        if (!creds?.token) {
          ctx.ui.notify('⚠️ 尚未登录，请先运行 /sync login', 'warning');
          return;
        }

        const password = await ctx.ui.input('🔑 输入主密码:', '');
        if (!password) return;

        ctx.ui.notify('☁️  正在从 GitHub 拉取加密数据...', 'info');
        try {
          let meta = loadMeta();
          if (!meta.gistId) {
            ctx.ui.notify('🔍 新设备检测，正在扫描 GitHub 账号寻找 AIIA 存档...', 'info');
            const gists = await githubFetch('https://api.github.com/gists?per_page=100', {}, creds.token);
            const found = gists.find(g => g.description === GIST_DESCRIPTION);
            if (!found) {
              ctx.ui.notify('❌ 未找到 AIIA 同步存档，请先在旧设备运行 /sync push。', 'error');
              return;
            }
            meta.gistId = found.id;
            saveMeta(meta);
          }

          const encryptedStr = await pullFromGist(creds.token, meta.gistId);
          if (!encryptedStr) {
            ctx.ui.notify('❌ 云端存档为空，请先在旧设备运行 /sync push。', 'error');
            return;
          }

          ctx.ui.notify('🔓 正在本地解密（仅在您的设备内存中进行）...', 'info');
          const plaintext = decrypt(JSON.parse(encryptedStr), password);
          const payload = JSON.parse(plaintext);

          const restored = [];
          const failed = [];

          for (const target of SYNC_TARGETS) {
            const content = payload.files?.[target.key];
            if (!content) continue;
            try {
              fs.mkdirSync(path.dirname(target.path), { recursive: true });
              if (target.type === 'directory') {
                // 还原目录
                fs.mkdirSync(target.path, { recursive: true, mode: 0o700 });
                for (const [rel, b64] of Object.entries(content)) {
                  const fullPath = path.join(target.path, rel);
                  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                  fs.writeFileSync(fullPath, Buffer.from(b64, 'base64'), { mode: 0o600 });
                }
              } else if (target.type === 'binary') {
                fs.writeFileSync(target.path, Buffer.from(content, 'base64'), { mode: 0o600 });
              } else {
                fs.writeFileSync(target.path, content, { mode: 0o600 });
              }
              restored.push(target.label);
            } catch (e) {
              failed.push(`${target.label} (${e.message})`);
            }
          }

          const summary = [
            `✅ 恢复成功！来源设备: ${payload.device || '未知'}，同步时间: ${payload.syncedAt}`,
            `   已恢复 ${restored.length} 项:\n     • ${restored.join('\n     • ')}`,
            failed.length ? `   ⚠️ 失败 ${failed.length} 项: ${failed.join(', ')}` : ''
          ].filter(Boolean).join('\n');
          ctx.ui.notify(summary, 'info');
        } catch (e) {
          ctx.ui.notify(`❌ 拉取失败: ${e.message}`, 'error');
        }
      }

      // ── list / status ─────────────────────────────────────────────────────
      else if (action === 'list' || action === 'status') {
        const creds = loadCredentials();
        const meta = loadMeta();

        const lines = ['─── AIIA 同步资源总览 ────────────────────────────────'];

        // 登录状态
        if (creds?.token) {
          lines.push(`🔑 登录账号: ${creds.username}  (授权于 ${creds.authorizedAt?.slice(0,10)})`);
        } else {
          lines.push('🔑 登录状态: ❌ 未登录（运行 /sync login）');
        }

        // Gist 状态
        lines.push(meta?.gistId
          ? `☁️  云端存档: https://gist.github.com/${meta.gistId}`
          : '☁️  云端存档: 未创建（运行 /sync push）');

        lines.push('');
        lines.push('📦 本地资源文件:');

        // 逐个资源显示状态
        for (const target of SYNC_TARGETS) {
          const exists = fs.existsSync(target.path);
          if (exists) {
            const stat = fs.statSync(target.path);
            const sizeKB = (stat.size / 1024).toFixed(1);
            const mtime = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
            lines.push(`  ✅ ${target.label}`);
            lines.push(`     📄 ${target.path}`);
            lines.push(`     📊 ${sizeKB} KB  |  修改时间: ${mtime}  ${target.sensitive ? '🔒 含机密' : ''}`);
          } else {
            lines.push(`  ⚠️  ${target.label}`);
            lines.push(`     📄 ${target.path}  (文件不存在，push 时会跳过)`);
          }
          lines.push('');
        }

        lines.push('─────────────────────────────────────────────────────');
        lines.push('💡 运行 /sync push 上传所有已存在的资源');
        lines.push('   运行 /sync pull 在新设备恢复所有资源');

        ctx.ui.notify(lines.join('\n'), 'info');
      }

      // ── help ─────────────────────────────────────────────────────────────
      else {
        ctx.ui.notify([
          '📖 AIIA 同步命令：',
          '  /sync login   — 点链接授权 GitHub，设置主密码（首次使用）',
          '  /sync list    — 查看所有同步资源的状态、路径和文件大小',
          '  /sync push    — 加密并上传所有本地资源到云端',
          '  /sync pull    — 从云端下载并在新设备解密恢复所有资源',
          '',
          '  📦 同步资源包含:',
          '     • ~/.secrets/env       API Keys & 密钥环境变量',
          '     • ~/.pi/agent/settings.json  Pi 全局设置',
          '     • ~/.config/aiia/config.json  AIIA 全局配置',
          '     • ~/.config/aiia/aiia.db     跨项目记忆库',
          '',
          '  ℹ️  主密码只在您的大脑里，云端只存密文，任何人无法解读。'
        ].join('\n'), 'info');
      }
    }
  });
}
