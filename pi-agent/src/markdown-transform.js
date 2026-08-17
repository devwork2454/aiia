/**
 * Markdown transformations for Pi's TUI renderer.
 *
 * Pi already renders Markdown (headings, code, lists) via pi-tui; but
 * GitHub-style callouts (`> [!NOTE]`) are NOT handled and show up as raw
 * text inside an italic quote. This transformer turns them into a bold
 * labeled line that pi-tui renders clearly.
 */

const CALLOUT_RE = /^(\s*>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;

const CALLOUT_LABELS = {
  NOTE: '📝 NOTE',
  TIP: '💡 TIP',
  IMPORTANT: '⭐ IMPORTANT',
  WARNING: '⚠️ WARNING',
  CAUTION: '⚠️ CAUTION',
};

export function isMarkdownTransformDisabled(env = process.env) {
  const v = env.AIIA_MARKDOWN_TRANSFORM_DISABLED;
  return v === '1' || v === 'true';
}

/**
 * Rewrite `> [!NOTE] rest` lines into `> **📝 NOTE** rest`.
 * Leaves every other line untouched, including lines inside fenced code
 * blocks (``` or ~~~). Callout body lines (continuation `> `) are not
 * matched and stay as-is.
 * @param {string} [markdown]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function transformGitHubCallouts(markdown, env = process.env) {
  const text = String(markdown ?? '');
  if (isMarkdownTransformDisabled(env)) return text;
  const FENCE_RE = /^\s*(```|~~~)/;
  let inCode = false;
  return text
    .split('\n')
    .map((line) => {
      if (FENCE_RE.test(line)) {
        inCode = !inCode;
        return line;
      }
      if (inCode) return line;
      const m = line.match(CALLOUT_RE);
      if (!m) return line;
      const [, prefix, kind, rest] = m;
      const head = CALLOUT_LABELS[kind.toUpperCase()] || kind.toUpperCase();
      const tail = rest.trim();
      return tail ? `${prefix}**${head}** ${tail}` : `${prefix}**${head}**`;
    })
    .join('\n');
}

/**
 * Build the transformer Pi expects: (markdown, context) => string.
 * Reads the kill switch from `env` on every call, so toggling it live works.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {(markdown: string) => string}
 */
export function createMarkdownTransformer(env = process.env) {
  return (markdown) => transformGitHubCallouts(markdown, env);
}
