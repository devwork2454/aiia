/**
 * Structured UserCard / ProjectCard for AIIA context injection.
 * Global: ~/.config/aiia/user-card.json
 * Optional project override: <cwd>/.agent/project-card.json (wins over global)
 * Env: AIIA_USER_CARD_PATH, AIIA_PROFILE_DISABLED=1
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * @typedef {{
 *   version: number,
 *   intent: string,
 *   stack: string[],
 *   user_tags: string[],
 *   prefer_tools: string[],
 *   avoid_tools: string[],
 *   noise_deny: string[],
 *   confidence: number,
 *   updated_at: string,
 *   fingerprint: string,
 * }} Card
 */

export const CARD_VERSION = 1;
export const MAX_PROFILE_PROMPT_CHARS = 900;

/** @type {Card} */
export const EMPTY_CARD = {
  version: CARD_VERSION,
  intent: "",
  stack: [],
  user_tags: [],
  prefer_tools: [],
  avoid_tools: [],
  noise_deny: [],
  confidence: 0,
  updated_at: new Date(0).toISOString(),
  fingerprint: "",
};

const FINGERPRINT_FILES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "ARCHITECTURE.md",
  "PROGRESS.md",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  ".agent/project-card.json",
];

function readJsonFile(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function stringArray(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => typeof x === "string");
}

function clampConfidence(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** @param {unknown} raw @returns {Card} */
export function normalizeCard(raw) {
  if (!raw || typeof raw !== "object") return { ...EMPTY_CARD };
  const obj = /** @type {Record<string, unknown>} */ (raw);
  return {
    version: CARD_VERSION,
    intent: String(obj.intent || "").trim(),
    stack: stringArray(obj.stack),
    user_tags: stringArray(obj.user_tags),
    prefer_tools: stringArray(obj.prefer_tools),
    avoid_tools: stringArray(obj.avoid_tools),
    noise_deny: stringArray(obj.noise_deny),
    confidence: clampConfidence(obj.confidence),
    updated_at:
      typeof obj.updated_at === "string" && obj.updated_at
        ? obj.updated_at
        : new Date(0).toISOString(),
    fingerprint: String(obj.fingerprint || "").trim(),
  };
}

function hasSignal(card) {
  return Boolean(
    card.intent ||
      card.stack.length ||
      card.user_tags.length ||
      card.prefer_tools.length ||
      card.avoid_tools.length ||
      card.noise_deny.length,
  );
}

export function userCardPath(env = process.env) {
  if (env.AIIA_USER_CARD_PATH) return resolve(env.AIIA_USER_CARD_PATH);
  return join(homedir(), ".config", "aiia", "user-card.json");
}

export function projectCardPath(cwd = process.cwd()) {
  return resolve(cwd, ".agent", "project-card.json");
}

export function loadUserCard({ env = process.env } = {}) {
  return normalizeCard(readJsonFile(userCardPath(env)));
}

export function loadProjectCard({ cwd = process.cwd() } = {}) {
  return normalizeCard(readJsonFile(projectCardPath(cwd)));
}

export function mergeCards(user, project) {
  const u = normalizeCard(user);
  const p = normalizeCard(project);
  return normalizeCard({
    version: CARD_VERSION,
    intent: p.intent || u.intent,
    stack: p.stack.length ? p.stack : u.stack,
    user_tags: p.user_tags.length ? p.user_tags : u.user_tags,
    prefer_tools: p.prefer_tools.length ? p.prefer_tools : u.prefer_tools,
    avoid_tools: p.avoid_tools.length ? p.avoid_tools : u.avoid_tools,
    noise_deny: p.noise_deny.length ? p.noise_deny : u.noise_deny,
    confidence: hasSignal(p) ? p.confidence : u.confidence,
    updated_at: p.updated_at > u.updated_at ? p.updated_at : u.updated_at,
    fingerprint: p.fingerprint || u.fingerprint,
  });
}

export function loadMergedCard({ cwd = process.cwd(), env = process.env } = {}) {
  return mergeCards(loadUserCard({ env }), loadProjectCard({ cwd }));
}

function saveCard(file, patch) {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const current = normalizeCard(readJsonFile(file));
  const next = {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch || {}).filter(([, v]) => v !== undefined),
    ),
    updated_at: new Date().toISOString(),
  };
  const normalized = normalizeCard(next);
  writeFileSync(file, JSON.stringify(normalized, null, 2) + "\n");
  return normalized;
}

export function saveUserCard(patch, env = process.env) {
  return saveCard(userCardPath(env), patch);
}

export function saveProjectCard(patch, cwd = process.cwd()) {
  return saveCard(projectCardPath(cwd), patch);
}

/**
 * @param {Card} card
 * @param {{ maxChars?: number }} [opts]
 * @returns {string}
 */
export function formatContextCardPrompt(card, { maxChars = MAX_PROFILE_PROMPT_CHARS } = {}) {
  const c = normalizeCard(card);
  if (!hasSignal(c)) return "";

  const lines = ["[AIIA context card]"];
  if (c.intent) lines.push(`intent: ${c.intent}`);
  if (c.stack.length) lines.push(`stack: ${c.stack.join(", ")}`);
  if (c.user_tags.length) lines.push(`tags: ${c.user_tags.join(", ")}`);
  if (c.prefer_tools.length) lines.push(`prefer_tools: ${c.prefer_tools.join(", ")}`);
  if (c.avoid_tools.length) lines.push(`avoid_tools: ${c.avoid_tools.join(", ")}`);
  if (c.noise_deny.length) {
    lines.push("constraints:");
    for (const item of c.noise_deny) {
      lines.push(`- ${item}`);
    }
  }

  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = text.slice(0, maxChars - 1) + "…";
  }
  return text;
}

export function isProfileDisabled(env = process.env) {
  return env.AIIA_PROFILE_DISABLED === "1" || env.AIIA_PROFILE_DISABLED === "true";
}

function projectCardContentHash(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { fingerprint: _fp, ...rest } = /** @type {Record<string, unknown>} */ (raw);
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

/** @param {string} root @param {string} rel @param {{ projectCardOverride?: Partial<Card> }} [opts] */
function fingerprintPart(root, rel, { projectCardOverride } = {}) {
  const file = join(root, rel);
  if (rel === ".agent/project-card.json" && projectCardOverride) {
    const hash = projectCardContentHash(normalizeCard(projectCardOverride));
    return hash ? `${rel}:${hash}` : null;
  }
  if (!existsSync(file)) return null;
  if (rel === ".agent/project-card.json") {
    const raw = readJsonFile(file);
    const hash = projectCardContentHash(raw);
    if (!hash) {
      const st = statSync(file);
      return `${rel}:${st.mtimeMs}:${st.size}`;
    }
    return `${rel}:${hash}`;
  }
  const st = statSync(file);
  return `${rel}:${st.mtimeMs}:${st.size}`;
}

/** @param {string} [cwd] @param {{ projectCardOverride?: Partial<Card> }} [opts] */
export function computeProjectFingerprint(cwd = process.cwd(), { projectCardOverride } = {}) {
  const root = resolve(cwd);
  const parts = [];
  for (const rel of [...FINGERPRINT_FILES].sort()) {
    const part = fingerprintPart(root, rel, { projectCardOverride });
    if (part) parts.push(part);
  }
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

/** @param {Card} card @param {string} [cwd] */
export function isCardStale(card, cwd = process.cwd()) {
  const fp = computeProjectFingerprint(cwd);
  return !card.fingerprint || card.fingerprint !== fp;
}

/** @param {string} [cwd] */
function extractGoalIntent(cwd = process.cwd()) {
  const file = join(resolve(cwd), "PROGRESS.md");
  if (!existsSync(file)) return "unspecified project";
  const content = readFileSync(file, "utf8");
  const match = content.match(/^##\s+GOAL\s*\n+([^\n#][^\n]*)/m);
  if (!match) return "unspecified project";
  const line = match[1].trim();
  if (!line) return "unspecified project";
  return line.length > 120 ? line.slice(0, 120) : line;
}

/** @param {string} [cwd] @returns {Partial<Card>} */
export function buildRuleBasedDraft(cwd = process.cwd()) {
  const root = resolve(cwd);
  /** @type {string[]} */
  const stack = [];
  /** @type {string[]} */
  const user_tags = [];

  if (existsSync(join(root, "package.json"))) stack.push("node");
  if (
    existsSync(join(root, "pyproject.toml")) ||
    existsSync(join(root, "requirements.txt"))
  ) {
    stack.push("python");
  }

  const archFile = join(root, "ARCHITECTURE.md");
  if (existsSync(archFile)) {
    const arch = readFileSync(archFile, "utf8");
    if (arch.includes("Pi")) {
      user_tags.push("pi");
    }
  }

  return {
    intent: extractGoalIntent(root),
    stack,
    user_tags,
    confidence: 0.4,
  };
}

/** @param {string} [cwd] */
export function projectDraftPath(cwd = process.cwd()) {
  return resolve(cwd, ".agent", "project-card.draft.json");
}

/** @param {string} [cwd] @param {Partial<Card>} draft */
export function writeProjectDraft(cwd, draft) {
  const file = projectDraftPath(cwd);
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(normalizeCard(draft), null, 2) + "\n");
  return file;
}

/** @param {string} [cwd] @returns {Card} */
export function applyProjectDraft(cwd = process.cwd()) {
  const draftFile = projectDraftPath(cwd);
  if (!existsSync(draftFile)) {
    throw new Error("No project-card draft found. Run /profile refresh first.");
  }
  const draft = normalizeCard(readJsonFile(draftFile));
  const cardBody = normalizeCard({ ...draft, fingerprint: "", updated_at: new Date().toISOString() });
  const fp = computeProjectFingerprint(cwd, { projectCardOverride: cardBody });
  const next = normalizeCard({ ...cardBody, fingerprint: fp });
  const file = projectCardPath(cwd);
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  unlinkSync(draftFile);
  return next;
}

/**
 * @param {string} [args]
 * @returns {{ action: string, scope?: string, field?: string, value?: string, error?: string }}
 */
export function parseProfileArgs(args = "") {
  const trimmed = String(args || "").trim();
  if (!trimmed) return { action: "show" };

  if (trimmed === "help" || trimmed.startsWith("help ")) {
    return { action: "help" };
  }

  if (trimmed.startsWith("set")) {
    const tokens = trimmed.split(/\s+/);
    let i = 1;
    let scope = "project";
    if (tokens[i] === "--user") {
      scope = "user";
      i++;
    }
    const field = tokens[i];
    const value = tokens.slice(i + 1).join(" ").trim();
    if (!field || !value) {
      return { action: "error", error: "Usage: /profile set [--user] <field> <value>" };
    }
    return { action: "set", scope, field, value };
  }

  const action = trimmed.split(/\s+/)[0].toLowerCase();
  if (action === "status") return { action: "show" };
  if (["show", "refresh", "apply", "on", "off"].includes(action)) {
    return { action };
  }

  return { action: "error", error: `Unknown /profile command: ${action}` };
}

/** @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [opts] */
export function formatProfileStatus({ cwd = process.cwd(), env = process.env } = {}) {
  const merged = loadMergedCard({ cwd, env });
  const project = loadProjectCard({ cwd });
  const stale = isCardStale(project, cwd);
  const draftExists = existsSync(projectDraftPath(cwd));
  const summary = formatContextCardPrompt(merged) || "(no card signal yet)";
  return [
    summary,
    `stale: ${stale ? "yes" : "no"}`,
    `draft: ${draftExists ? "yes" : "no"}`,
    `profile_disabled: ${isProfileDisabled(env) ? "yes" : "no"}`,
  ].join("\n");
}
