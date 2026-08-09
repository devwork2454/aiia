/**
 * Global reply language + style preferences for Pi.
 * Global: ~/.config/aiia/reply-prefs.json
 * Optional project override: <cwd>/.agent/reply-prefs.json (wins over global)
 * Env: AIIA_REPLY_LANG, AIIA_REPLY_STYLE, AIIA_REPLY_DISABLED=1
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const STYLE_PRESETS = {
  concise: "Concise: short and direct; minimal filler; use bullet lists when helpful; one-line summary when appropriate.",
  detailed: "Detailed: explain reasoning and trade-offs; keep structure clear; avoid unnecessary padding.",
  professional: "Professional: formal tone; precise wording; no slang or emoji.",
  casual: "Casual: friendly, plain language; still accurate and actionable.",
  technical: "Technical: prefer exact terms, APIs, and paths; cite files/commands; less marketing language.",
};

const EMPTY = { language: "", style: "", enabled: true };

export function globalPrefsPath(env = process.env) {
  if (env.AIIA_REPLY_PREFS_PATH) return resolve(env.AIIA_REPLY_PREFS_PATH);
  return join(homedir(), ".config", "aiia", "reply-prefs.json");
}

export function projectPrefsPath(cwd = process.cwd()) {
  return resolve(cwd, ".agent", "reply-prefs.json");
}

function readJsonFile(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function normalizePrefs(raw) {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  return {
    language: String(raw.language || "").trim(),
    style: String(raw.style || "").trim(),
    enabled: raw.enabled !== false && raw.enabled !== "0",
  };
}

export function loadPrefs({ cwd = process.cwd(), env = process.env } = {}) {
  const global = normalizePrefs(readJsonFile(globalPrefsPath(env)));
  const project = normalizePrefs(readJsonFile(projectPrefsPath(cwd)));
  // project fields override when non-empty; enabled: project file present with enabled key wins if set
  const merged = {
    language: project.language || global.language,
    style: project.style || global.style,
    enabled: global.enabled,
  };
  const projectRaw = readJsonFile(projectPrefsPath(cwd));
  if (projectRaw && Object.prototype.hasOwnProperty.call(projectRaw, "enabled")) {
    merged.enabled = projectRaw.enabled !== false && projectRaw.enabled !== "0";
  }
  // env overrides (highest)
  if (env.AIIA_REPLY_DISABLED === "1" || env.AIIA_REPLY_DISABLED === "true") {
    merged.enabled = false;
  }
  if (env.AIIA_REPLY_LANG) merged.language = String(env.AIIA_REPLY_LANG).trim();
  if (env.AIIA_REPLY_STYLE) merged.style = String(env.AIIA_REPLY_STYLE).trim();
  return merged;
}

export function saveGlobalPrefs(patch, env = process.env) {
  const file = globalPrefsPath(env);
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const current = normalizePrefs(readJsonFile(file));
  const next = {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch || {}).filter(([, v]) => v !== undefined),
    ),
  };
  const normalized = normalizePrefs(next);
  writeFileSync(file, JSON.stringify(normalized, null, 2) + "\n");
  return normalized;
}

export function resetGlobalPrefs(env = process.env) {
  return saveGlobalPrefs({ ...EMPTY }, env);
}

export function resolveStyleDirective(style) {
  const s = String(style || "").trim();
  if (!s) return "";
  if (STYLE_PRESETS[s]) return STYLE_PRESETS[s];
  if (s.startsWith("custom:")) {
    const body = s.slice("custom:".length).trim();
    return body ? `Custom style: ${body}` : "";
  }
  // free-form style text
  return `Style guidance: ${s}`;
}

export function resolveLanguageDirective(language) {
  const lang = String(language || "").trim();
  if (!lang) return "";
  const lower = lang.toLowerCase();
  if (lower === "zh" || lower === "zh-cn" || lower === "zh_cn" || lower === "chinese") {
    return "Language: Always reply in Simplified Chinese (简体中文), unless the user explicitly asks for another language.";
  }
  if (lower === "en" || lower === "en-us" || lower === "english") {
    return "Language: Always reply in English, unless the user explicitly asks for another language.";
  }
  return `Language: Always reply in ${lang}, unless the user explicitly asks for another language.`;
}

/**
 * @returns {string} empty when nothing to inject
 */
export function formatReplyPrefsPrompt(prefs) {
  if (!prefs || prefs.enabled === false) return "";
  const lang = resolveLanguageDirective(prefs.language);
  const style = resolveStyleDirective(prefs.style);
  if (!lang && !style) return "";
  const lines = ["[AIIA Reply Preferences — global settings]"];
  if (lang) lines.push(lang);
  if (style) lines.push(style);
  lines.push("Follow these preferences for all user-facing replies in this session.");
  return lines.join("\n");
}

/**
 * Parse `/reply` args.
 * @returns {{action:string, value?:string, error?:string}}
 */
export function parseReplyArgs(args = "") {
  const text = String(args || "").trim();
  if (!text) return { action: "show" };
  const [head, ...rest] = text.split(/\s+/);
  const h = head.toLowerCase();
  const value = rest.join(" ").trim();
  if (h === "show" || h === "status" || h === "list") return { action: "show" };
  if (h === "help" || h === "-h" || h === "--help") return { action: "help" };
  if (h === "reset") return { action: "reset" };
  if (h === "off" || h === "disable") return { action: "enable", value: "0" };
  if (h === "on" || h === "enable") return { action: "enable", value: "1" };
  if (h === "lang" || h === "language") {
    if (!value) return { action: "error", error: "Usage: /reply lang <zh-CN|en|...>" };
    return { action: "lang", value };
  }
  if (h === "style") {
    if (!value) {
      return {
        action: "error",
        error: `Usage: /reply style <${Object.keys(STYLE_PRESETS).join("|")}|custom:...|free text>`,
      };
    }
    return { action: "style", value };
  }
  return { action: "error", error: "Unknown. Try: /reply | /reply lang zh-CN | /reply style concise | /reply reset" };
}

export function formatStatus(prefs, { globalPath, projectPath } = {}) {
  const lines = [
    "AIIA reply preferences (global):",
    `  enabled:  ${prefs.enabled !== false}`,
    `  language: ${prefs.language || "(unset — Pi default)"}`,
    `  style:    ${prefs.style || "(unset — Pi default)"}`,
  ];
  if (globalPath) lines.push(`  global:   ${globalPath}`);
  if (projectPath && existsSync(projectPath)) lines.push(`  project:  ${projectPath} (overrides non-empty fields)`);
  lines.push(`  presets:  ${Object.keys(STYLE_PRESETS).join(", ")}`);
  return lines.join("\n");
}
