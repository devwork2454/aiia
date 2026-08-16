/**
 * AIIA Custom Footer
 * 三行定制页脚：品牌/路径/分支 · token 统计/上下文占用 · 实时轮次状态。
 * 颜色全部走主题令牌（跟随 tokyo-night 等主题自动变化）。
 * Kill: AIIA_VISUAL_DISABLED=1
 */

import { isExtensionEnabled } from "../src/extension-profile.js";

import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";

/** 紧凑 token 计数：1.2k / 34k / 1.5M / 2M。 */
function compact(n) {
  const v = Number(n) || 0;
  if (v < 1000) return `${v}`;
  if (v < 10_000) return `${(v / 1000).toFixed(1)}k`;
  if (v < 1_000_000) return `${Math.round(v / 1000)}k`;
  if (v < 10_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  return `${Math.round(v / 1_000_000)}M`;
}

function sanitizeStatus(text) {
  return String(text || "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

/** 依据状态文本推断主题色：运行中→accent，完成→success，异常→error。 */
function statusColor(text, theme) {
  if (/⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏|正在|运行中|执行/.test(text)) return theme.fg("accent", text);
  if (/✓|\[Ready\]|完成|成功/.test(text)) return theme.fg("success", text);
  if (/⚠|🔴|错误|失败|阻塞/.test(text)) return theme.fg("error", text);
  return theme.fg("muted", text);
}

/**
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
export default function uiFooterExtension(pi) {
  if (!isExtensionEnabled("ui-footer")) return;

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.ui?.setFooter) return;
    const session = ctx.sessionManager;
    const model = () => ctx.model;

    ctx.ui.setFooter((_tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => {
        // FooterDataProvider 内部会触发重绘；此处仅防御性保留订阅句柄。
      });

      return {
        dispose() {
          unsub();
        },
        invalidate() {},
        render(width) {
          // ── 行1：品牌 + 路径(分支) + 会话名 ──
          const cwd = session.getCwd() || process.cwd();
          const home = process.env.HOME || process.env.USERPROFILE || "";
          let pwd = cwd;
          if (home && cwd.startsWith(home)) pwd = `~${cwd.slice(home.length)}`;
          const branch = footerData.getGitBranch();
          const pathPart = branch ? `${pwd} (${branch})` : pwd;
          const sessionName = session.getSessionName();
          const titleLine = [
            theme.fg("accent", "◆ AIIA"),
            theme.fg("dim", pathPart),
            sessionName ? theme.fg("muted", `• ${sessionName}`) : "",
          ]
            .filter(Boolean)
            .join(" ");

          // ── 行2：token 统计 + 上下文 + 模型 ──
          let input = 0;
          let output = 0;
          let cacheRead = 0;
          let cacheWrite = 0;
          let turns = 0;
          for (const entry of session.getBranch()) {
            if (entry.type !== "message") continue;
            const msg = entry.message;
            if (msg.role === "assistant") {
              const u = msg.usage;
              if (u) {
                input += u.input || 0;
                output += u.output || 0;
                cacheRead += u.cacheRead || 0;
                cacheWrite += u.cacheWrite || 0;
              }
              turns += 1;
            } else if (msg.role === "toolResult" && msg.usage) {
              const u = msg.usage;
              input += u.input || 0;
              output += u.output || 0;
              cacheRead += u.cacheRead || 0;
              cacheWrite += u.cacheWrite || 0;
            }
          }
          const total = input + output + cacheRead + cacheWrite;
          const cacheDenom = input + cacheRead + cacheWrite;
          const cachePct = cacheDenom > 0 ? Math.round((cacheRead / cacheDenom) * 100) : null;

          const statsParts = [];
          statsParts.push(theme.fg("dim", `↑${compact(input)} ↓${compact(output)}`));
          if (total > 0) statsParts.push(theme.fg("accent", `Σ${compact(total)}`));
          if (cachePct !== null) statsParts.push(theme.fg("muted", `缓存 ${cachePct}%`));
          if (turns > 0) statsParts.push(theme.fg("muted", `${turns} 轮`));

          // 上下文占用（>90 红 / >70 黄）
          const contextUsage = session.getContextUsage?.();
          const contextWindow = contextUsage?.contextWindow ?? model()?.contextWindow ?? 0;
          const pctValue = contextUsage?.percent ?? 0;
          const pctDisplay =
            contextUsage?.percent !== null && contextUsage?.percent !== undefined
              ? `${pctValue.toFixed(1)}%${contextWindow ? `/${compact(contextWindow)}` : ""}`
              : "?";
          statsParts.push(
            pctValue > 90
              ? theme.fg("error", pctDisplay)
              : pctValue > 70
                ? theme.fg("warning", pctDisplay)
                : theme.fg("dim", pctDisplay),
          );

          const statsLeft = statsParts.join(" ");
          const modelName = model()?.id || "no-model";
          const statsRight = theme.fg("dim", modelName);
          const padding = " ".repeat(
            Math.max(2, width - visibleWidth(statsLeft) - visibleWidth(statsRight)),
          );
          const statsLine = truncateToWidth(statsLeft + padding + statsRight, width);

          // ── 行3：扩展实时状态（turn-status 等） ──
          const statuses = Array.from(footerData.getExtensionStatuses().entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, text]) => statusColor(sanitizeStatus(text), theme));
          const statusLine =
            statuses.length > 0
              ? truncateToWidth(statuses.join("  "), width, theme.fg("dim", "..."))
              : theme.fg("dim", "");

          return [
            truncateToWidth(titleLine, width, theme.fg("dim", "...")),
            statsLine,
            statusLine,
          ];
        },
      };
    });
  });
}
