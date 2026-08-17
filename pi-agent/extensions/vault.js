/**
 * AIIA Vault Extension
 * 本地加密存储结构化敏感数据：账号密码、身份信息、地址、银行卡、自定义笔记
 * 数据存储于 ~/.config/aiia/vault.enc.json（AES-256-GCM 加密，不落明文）
 *
 * 用法:
 *   /vault                     — 帮助
 *   /vault list [分类]          — 列出条目（默认掩码）
 *   /vault add <分类> <名称>    — 交互式添加条目
 *   /vault show <分类> <名称>   — 查看条目明文（需输入主密码）
 *   /vault delete <分类> <名称>— 删除条目（需输入主密码）
 *   /vault categories          — 查看所有分类
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { registerAiiaHandler } from '../src/command-registry.js';

// ─── 常量 ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.config', 'aiia');
const VAULT_FILE = path.join(CONFIG_DIR, 'vault.enc.json'); // 加密存储
const CREDENTIALS_FILE = path.join(CONFIG_DIR, '.credentials.json');

// 加密参数（与 sync.js 保持一致）
const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITERATIONS = 210000;
const KEY_LENGTH = 32;
const DIGEST = 'sha512';

// ─── 预定义分类 ───────────────────────────────────────────────────────────────

const CATEGORIES = {
  account: { label: '账号密码', icon: '🔐', fields: ['用户名', '密码', '网址', '备注'] },
  identity: {
    label: '身份信息',
    icon: '🪪',
    fields: ['姓名', '身份证号', '手机号', '邮箱', '备注'],
  },
  address: {
    label: '地址信息',
    icon: '🏠',
    fields: ['联系人', '手机号', '省市区', '详细地址', '邮编'],
  },
  payment: {
    label: '银行卡/支付',
    icon: '💳',
    fields: ['持卡人', '卡号', '银行', '有效期', '备注'],
  },
  ssh: {
    label: 'SSH/服务器',
    icon: '🖥️',
    fields: ['主机名', 'IP/域名', '端口', '用户名', '密钥路径', '备注'],
  },
  note: { label: '安全笔记', icon: '📝', fields: ['标题', '内容'] },
  custom: { label: '自定义', icon: '📦', fields: [] }, // 用户自定义字段
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
}

function encryptVault(data, password) {
  const plaintext = JSON.stringify(data);
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
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

function decryptVault(encrypted, password) {
  try {
    const salt = Buffer.from(encrypted.salt, 'hex');
    const iv = Buffer.from(encrypted.iv, 'hex');
    const authTag = Buffer.from(encrypted.authTag, 'hex');
    const key = deriveKey(password, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let plaintext = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return JSON.parse(plaintext);
  } catch {
    throw new Error('Vault 解密失败，主密码错误或数据损坏。');
  }
}

/** 读取并解密整个 Vault */
function readVault(password) {
  if (!fs.existsSync(VAULT_FILE)) return {};
  const encrypted = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
  return decryptVault(encrypted, password);
}

/** 加密并写入整个 Vault */
function writeVault(data, password) {
  ensureConfigDir();
  const encrypted = encryptVault(data, password);
  fs.writeFileSync(VAULT_FILE, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
}

/** 掩码展示（保留首尾字符） */
function mask(value) {
  if (!value || value.length <= 2) return '••••';
  if (value.length <= 6) return value[0] + '•'.repeat(value.length - 2) + value.slice(-1);
  return value.slice(0, 2) + '•'.repeat(Math.min(value.length - 4, 8)) + value.slice(-2);
}

/** 获取或验证主密码 */
async function getMasterPassword(ctx, action = '操作') {
  const creds = loadCredentials();
  const password = await ctx.ui.input(`🔒 请输入主密码以${action}:`, '');
  if (!password) throw new Error('未输入主密码，已取消。');

  // 如果有本地哈希则校验
  if (creds?.pwHash) {
    let inputHash;
    if (creds.pwSalt) {
      inputHash = crypto
        .pbkdf2Sync(password, Buffer.from(creds.pwSalt, 'hex'), ITERATIONS, KEY_LENGTH, DIGEST)
        .toString('hex');
    } else {
      inputHash = crypto.createHash('sha256').update(password).digest('hex');
    }
    if (inputHash !== creds.pwHash) throw new Error('主密码错误，操作已取消。');
  }
  return password;
}

// ─── Pi 命令注册 ──────────────────────────────────────────────────────────────

export default function (pi) {
  const vaultHandler = async (args, ctx) => {
    const parts = (args || '').trim().split(/\s+/);
    const action = parts[0] || 'help';

    // ── categories ──────────────────────────────────────────────────────
    if (action === 'categories') {
      const lines = ['📂 可用分类：', ''];
      for (const [key, cat] of Object.entries(CATEGORIES)) {
        lines.push(`  ${cat.icon}  ${key.padEnd(10)} — ${cat.label}`);
        if (cat.fields.length > 0) {
          lines.push(`              字段: ${cat.fields.join('、')}`);
        }
      }
      ctx.ui.notify(lines.join('\n'), 'info');
      return;
    }

    // ── list ─────────────────────────────────────────────────────────────
    if (action === 'list') {
      let password;
      try {
        password = await getMasterPassword(ctx, '查看保险箱');
      } catch (e) {
        ctx.ui.notify(`❌ ${e.message}`, 'error');
        return;
      }

      let vault;
      try {
        vault = readVault(password);
      } catch (e) {
        ctx.ui.notify(`❌ ${e.message}`, 'error');
        return;
      }

      const filterCat = parts[1];
      const lines = ['🔐 AIIA Vault — 条目列表（已掩码）', ''];

      let total = 0;
      for (const [catKey, entries] of Object.entries(vault)) {
        if (filterCat && catKey !== filterCat) continue;
        const cat = CATEGORIES[catKey] || { label: catKey, icon: '📦' };
        const entryKeys = Object.keys(entries || {});
        if (entryKeys.length === 0) continue;

        lines.push(`${cat.icon} ${cat.label} (${catKey}) — ${entryKeys.length} 条`);
        for (const name of entryKeys) {
          const entry = entries[name];
          const preview = Object.entries(entry)
            .slice(0, 2)
            .map(([k, v]) => `${k}: ${mask(v)}`)
            .join('  |  ');
          lines.push(`   • ${name.padEnd(20)} ${preview}`);
          total++;
        }
        lines.push('');
      }

      if (total === 0) {
        lines.push(
          filterCat
            ? `  分类 "${filterCat}" 中暂无条目，使用 /vault add ${filterCat} <名称> 添加`
            : '  保险箱为空，使用 /vault add <分类> <名称> 添加第一条',
        );
      } else {
        lines.push(`共 ${total} 条 | /vault show <分类> <名称> 查看明文`);
      }

      ctx.ui.notify(lines.join('\n'), 'info');
      return;
    }

    // ── add ──────────────────────────────────────────────────────────────
    if (action === 'add') {
      const catKey = parts[1];
      const entryName = parts.slice(2).join(' ');

      if (!catKey) {
        ctx.ui.notify(
          '❌ 请指定分类，例如: /vault add account Gmail\n   运行 /vault categories 查看所有分类',
          'error',
        );
        return;
      }
      if (!entryName) {
        ctx.ui.notify(`❌ 请指定条目名称，例如: /vault add ${catKey} Gmail账号`, 'error');
        return;
      }

      let password;
      try {
        password = await getMasterPassword(ctx, '添加条目');
      } catch (e) {
        ctx.ui.notify(`❌ ${e.message}`, 'error');
        return;
      }

      let vault;
      try {
        vault = readVault(password);
      } catch (e) {
        ctx.ui.notify(`❌ ${e.message}`, 'error');
        return;
      }

      const cat = CATEGORIES[catKey] || CATEGORIES.custom;
      ctx.ui.notify(
        `\n${cat.icon} 正在添加「${cat.label}」条目：${entryName}\n（直接回车跳过某个字段）`,
        'info',
      );

      const entry = {};
      const fields = cat.fields.length > 0 ? cat.fields : ['字段名（自定义）'];

      for (const field of fields) {
        const value = await ctx.ui.input(`  ${field}: `, '');
        if (value) entry[field] = value;
      }

      // 支持添加额外自定义字段
      if (catKey !== 'note') {
        let more = await ctx.ui.input('\n  是否添加更多自定义字段？输入字段名（回车跳过）: ', '');
        while (more) {
          const value = await ctx.ui.input(`  ${more}: `, '');
          if (value) entry[more] = value;
          more = await ctx.ui.input('  继续添加字段（回车结束）: ', '');
        }
      }

      if (Object.keys(entry).length === 0) {
        ctx.ui.notify('⚠️ 未输入任何内容，已取消。', 'warning');
        return;
      }

      // 写入
      if (!vault[catKey]) vault[catKey] = {};
      entry._createdAt = new Date().toISOString();
      vault[catKey][entryName] = entry;
      writeVault(vault, password);

      ctx.ui.notify(`✅ 已保存「${entryName}」到 ${cat.icon} ${cat.label}（本地加密存储）`, 'info');
      return;
    }

    // ── show ─────────────────────────────────────────────────────────────
    if (action === 'show') {
      const catKey = parts[1];
      const entryName = parts.slice(2).join(' ');

      if (!catKey || !entryName) {
        ctx.ui.notify('❌ 用法: /vault show <分类> <名称>', 'error');
        return;
      }

      let password;
      try {
        password = await getMasterPassword(ctx, '查看明文');
      } catch (e) {
        ctx.ui.notify(`❌ ${e.message}`, 'error');
        return;
      }

      let vault;
      try {
        vault = readVault(password);
      } catch (e) {
        ctx.ui.notify(`❌ ${e.message}`, 'error');
        return;
      }

      const entry = vault[catKey]?.[entryName];
      if (!entry) {
        ctx.ui.notify(`❌ 未找到「${catKey} / ${entryName}」`, 'error');
        return;
      }

      const cat = CATEGORIES[catKey] || { label: catKey, icon: '📦' };
      const lines = [`\n${cat.icon} ${cat.label} — ${entryName}`, '─'.repeat(40)];
      for (const [k, v] of Object.entries(entry)) {
        if (k.startsWith('_')) continue;
        lines.push(`  ${k.padEnd(12)}: ${v}`);
      }
      lines.push('─'.repeat(40));
      ctx.ui.notify(lines.join('\n'), 'info');
      return;
    }

    // ── delete ───────────────────────────────────────────────────────────
    if (action === 'delete' || action === 'del') {
      const catKey = parts[1];
      const entryName = parts.slice(2).join(' ');

      if (!catKey || !entryName) {
        ctx.ui.notify('❌ 用法: /vault delete <分类> <名称>', 'error');
        return;
      }

      const confirmed = await ctx.ui.confirm(
        '确认删除',
        `是否删除「${catKey} / ${entryName}」？此操作不可恢复。`,
      );
      if (!confirmed) {
        ctx.ui.notify('已取消', 'info');
        return;
      }

      let password;
      try {
        password = await getMasterPassword(ctx, '删除条目');
      } catch (e) {
        ctx.ui.notify(`❌ ${e.message}`, 'error');
        return;
      }

      let vault;
      try {
        vault = readVault(password);
      } catch (e) {
        ctx.ui.notify(`❌ ${e.message}`, 'error');
        return;
      }

      if (!vault[catKey]?.[entryName]) {
        ctx.ui.notify(`❌ 未找到「${catKey} / ${entryName}」`, 'error');
        return;
      }

      delete vault[catKey][entryName];
      writeVault(vault, password);
      ctx.ui.notify(`✅ 已删除「${entryName}」`, 'info');
      return;
    }

    // ── help ─────────────────────────────────────────────────────────────
    ctx.ui.notify(
      [
        '🔐 AIIA Vault — 本地加密个人保险箱',
        '',
        '  /vault list [分类]           — 列出条目（掩码显示）',
        '  /vault add <分类> <名称>     — 交互式添加一条记录',
        '  /vault show <分类> <名称>    — 查看某条记录的明文',
        '  /vault delete <分类> <名称>  — 删除某条记录',
        '  /vault categories            — 查看所有可用分类',
        '',
        '  📂 内置分类:',
        '     account  — 账号密码（用户名/密码/网址）',
        '     identity — 身份信息（姓名/身份证/手机）',
        '     address  — 地址信息（联系人/省市区/详细地址）',
        '     payment  — 银行卡/支付（卡号/银行/有效期）',
        '     ssh      — SSH/服务器（IP/端口/用户名/密钥）',
        '     note     — 安全笔记',
        '     custom   — 自定义分类',
        '',
        '  🔒 数据本地 AES-256 加密存储，同步时随 /sync push 一并上传（仍为密文）',
      ].join('\n'),
      'info',
    );
  };

  pi.registerCommand('vault', {
    description: '本地加密个人保险箱 | 管理账号密码/身份/地址/银行卡/SSH等敏感信息',
    handler: vaultHandler,
  });
  registerAiiaHandler('vault', vaultHandler);
}
