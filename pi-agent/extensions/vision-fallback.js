/**
 * AIIA Vision Fallback Extension
 *
 * 当请求 payload 含图片（image_url / image），而当前模型不支持视觉输入时，
 * 自动调用 Gemini 视觉模型把每张图片转述为结构化文本描述，替换 payload 中的
 * 图片块，避免文本模型上游返回 400 (unknown variant `image_url`)。
 *
 * 触发点：before_provider_request（payload 序列化之前），无需等待报错后重试。
 *
 * 配置：
 *   AIIA_VISION_FALLBACK=0        关闭本扩展（默认开启）
 *   AIIA_VISION_MODEL=gemini-2.5-flash   转述用视觉模型（默认 gemini-2.5-flash）
 *   AIIA_VISION_MODELS=gpt-4o,gemini-2.5-flash  已知支持视觉的模型白名单（命中则放行原图）
 *   GEMINI_API_KEYS=...           官方格式 key（已存在）
 */
import { isExtensionEnabled } from '../src/extension-profile.js';

const DEFAULT_VISION_MODEL = 'gemini-2.5-flash';
const DEFAULT_TIMEOUT_MS = 30000;
const GEMINI_GENERATE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent';

const DESCRIBE_PROMPT =
  '你是视觉转述器。请用结构化中文详尽描述这张图片的事实信息：画面内容、' +
  '文字（原样摘录）、布局、颜色、数量、界面元素、数据表格等，供纯文本大模型准确理解。' +
  '只描述事实，不做评论和推测。';

const FAILED_PLACEHOLDER =
  '[图片附件：当前模型不支持图像输入，自动识别失败，请切换支持视觉的模型查看原图]';

const NO_KEY_PLACEHOLDER =
  '[图片附件：当前模型不支持图像输入，且未配置 GEMINI_API_KEYS，无法自动识别]';

/** 从 GEMINI_API_KEYS 中取第一个官方格式 key（跳过 URL 格式网关项）。 */
export function getGeminiKey(env = process.env) {
  const raw = env.GEMINI_API_KEYS || '';
  for (const part of raw.split(/[,;|\s]+/)) {
    const k = part.trim();
    if (k && !/^https?:\/\//i.test(k)) return k;
  }
  return null;
}

function splitList(value) {
  return String(value || '')
    .split(/[,;|\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 从图片块中提取 base64 / 远程 URL / 本地文件路径 + mime。 */
export function extractImageData(block) {
  if (!block || typeof block !== 'object') return null;
  if (block.type === 'image_url') {
    const url = block?.image_url?.url || '';
    const m = url.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    if (m) return { base64: m[2], mime: m[1] };
    if (/^https?:\/\//i.test(url)) return { url };
    if (url.startsWith('file://')) return { fileUri: url };
    if (url.startsWith('/')) return { filePath: url };
    return null;
  }
  if (block.type === 'image') {
    const src = block?.source || {};
    if (src.type === 'base64') {
      return { base64: src.data, mime: src.media_type || src.mediaType || 'image/png' };
    }
    if (src.type === 'url' && /^https?:\/\//i.test(src.url)) return { url: src.url };
    if (src.type === 'url' && src.url?.startsWith('file://')) return { fileUri: src.url };
    if (src.type === 'url' && src.url?.startsWith('/')) return { filePath: src.url };
  }
  return null;
}

/**
 * 用 Gemini 将单张图片转述为文本。
 * @returns {Promise<string|null>} 描述文本；任何失败返回 null。
 */
export async function describeImageWithGemini(block, opts = {}) {
  const { apiKey, model = DEFAULT_VISION_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!apiKey) return null;

  const img = extractImageData(block);
  if (!img) return null;

  let base64 = img.base64;
  let mime = img.mime || 'image/png';

  if (img.fileUri || img.filePath) {
    try {
      const fs = await import('node:fs/promises');
      const { fileURLToPath } = await import('node:url');
      const extname = (await import('node:path')).extname;

      const p = img.fileUri ? fileURLToPath(img.fileUri) : img.filePath;
      const ext = extname(p).toLowerCase();
      mime =
        ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : 'image/png';

      const buf = await fs.readFile(p);
      base64 = buf.toString('base64');
    } catch (e) {
      return null;
    }
  } else if (img.url) {
    try {
      const resp = await fetchImpl(img.url);
      if (!resp.ok) return null;
      const buf = Buffer.from(await resp.arrayBuffer());
      base64 = buf.toString('base64');
      mime = resp.headers?.get?.('content-type') || mime;
    } catch {
      return null;
    }
  }

  const body = {
    contents: [
      {
        parts: [{ text: DESCRIBE_PROMPT }, { inline_data: { mime_type: mime, data: base64 } }],
      },
    ],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(GEMINI_GENERATE_URL.replace('%s', model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('')
      .trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 把 image 块原地替换为文本块。 */
function replaceBlockWithText(block, text) {
  delete block.image_url;
  delete block.source;
  block.type = 'text';
  block.text = text;
}

/**
 * 扫描 messages，把其中的图片块并发转述为文本并原地替换。
 * @param {Array} messages OpenAI 格式 messages
 * @param {(block: object) => Promise<string|null>} describeFn
 * @returns {{ replaced: number, failed: number, missingKey: boolean }}
 */
export async function buildVisionFallbackMessages(messages, describeFn) {
  const hits = [];
  for (const msg of messages) {
    if (!msg || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block && (block.type === 'image_url' || block.type === 'image')) {
        hits.push(block);
      }
    }
  }
  if (!hits.length) return { replaced: 0, failed: 0, missingKey: false };

  const results = await Promise.all(hits.map((b) => describeFn(b)));
  let replaced = 0;
  let failed = 0;
  for (let i = 0; i < hits.length; i += 1) {
    const text = results[i];
    if (text) {
      replaceBlockWithText(hits[i], text);
      replaced += 1;
    } else {
      replaceBlockWithText(hits[i], FAILED_PLACEHOLDER);
      failed += 1;
    }
  }
  return { replaced, failed, missingKey: false };
}

function getRequestPayload(event) {
  if (event?.payload && typeof event.payload === 'object') return event.payload;
  if (event?.req && typeof event.req === 'object') return event.req;
  return null;
}

export default function visionFallbackExtension(pi) {
  if (!isExtensionEnabled('vision-fallback')) return;

  pi.on('before_provider_request', async (event, ctx) => {
    if (process.env.AIIA_VISION_FALLBACK === '0') return;

    const req = getRequestPayload(event);
    if (!req || !Array.isArray(req.messages)) return;

    // 已知支持视觉的模型 → 放行原图（无谓转述只会增加延迟与成本）
    const curModel = String(ctx?.model?.id || req?.model || '');
    if (curModel) {
      const visionModels = splitList(process.env.AIIA_VISION_MODELS);
      if (visionModels.some((m) => curModel === m || curModel.includes(m))) return;
    }

    const apiKey = getGeminiKey(process.env);
    if (!apiKey) {
      // 无 key：把图片替换为占位文本，至少保证请求不 400
      for (const msg of req.messages) {
        if (!Array.isArray(msg?.content)) continue;
        for (const block of msg.content) {
          if (block && (block.type === 'image_url' || block.type === 'image')) {
            replaceBlockWithText(block, NO_KEY_PLACEHOLDER);
          }
        }
      }
      return;
    }

    const model = process.env.AIIA_VISION_MODEL || DEFAULT_VISION_MODEL;

    let imageCount = 0;
    for (const msg of req.messages) {
      if (!Array.isArray(msg?.content)) continue;
      for (const block of msg.content) {
        if (block && (block.type === 'image_url' || block.type === 'image')) {
          imageCount++;
        }
      }
    }

    if (imageCount > 0 && ctx?.ui?.notify) {
      ctx.ui.notify(
        `🖼 正在调用视觉降级模型分析 ${imageCount} 张图片，可能需要几秒钟，请稍候...`,
        'info',
      );
    }

    const describeFn = (block) =>
      describeImageWithGemini(block, { apiKey, model, fetchImpl: globalThis.fetch });

    const { replaced, failed } = await buildVisionFallbackMessages(req.messages, describeFn);
    if (replaced + failed > 0 && ctx?.ui?.notify) {
      const detail = failed > 0 ? `${failed} 张识别失败已占位` : '';
      ctx.ui.notify(
        `🖼 视觉降级：${replaced} 张图片已转述为文本${detail ? `（${detail}）` : ''}`,
        'info',
      );
    }
  });
}
