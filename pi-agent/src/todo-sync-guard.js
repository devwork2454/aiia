/**
 * Pure helpers for the todo-list / reply sync guard.
 * Checks whether the assistant reply's progress claims match the latest
 * update_todos list state. Pure functions, no side effects, unit-testable.
 */

export const PROGRESS_RE = /\[进度\s*(\d+)\s*\/\s*(\d+)\]/;
/** Strong wrap-up signals — a reply containing these claims the task is ending. */
export const DONE_WORDS_RE =
  /(全部完成|已完成|任务完成|收工|收尾|清单已全部|所有任务已完成|已全部完成|全部 done|全部 ✅)/;
/** Negations that void the wrap-up claim. */
export const NEGATION_RE = /(未完成|没完成|尚未完成|未全部|未收尾|仍有|还剩下|待办|进行中|未归位)/;

/**
 * Extract the plain text of an assistant message (handles string or content
 * array payloads).
 */
export function extractReplyText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" ? part.text ?? "" : String(part ?? "")))
      .join("");
  }
  return "";
}

/**
 * Compare the reply's progress claims against the latest todo list state.
 *
 * @param {Array<{status?: string}>} todos normalized todo items
 * @param {string} replyText assistant reply text
 * @returns {string[]} human-readable issues (empty when consistent)
 */
export function checkTodoSync(todos, replyText) {
  const list = Array.isArray(todos) ? todos : [];
  const reply = String(replyText || "");
  const issues = [];

  const incomplete = list.filter((t) => t.status !== "completed").length;
  const inProgress = list.filter((t) => t.status === "in_progress").length;
  const allDone = list.length > 0 && incomplete === 0;
  const cleared = list.length === 0;

  const progress = reply.match(PROGRESS_RE);
  if (progress) {
    const current = Number(progress[1]);
    const total = Number(progress[2]);
    if (current < total) {
      if (allDone || cleared) {
        issues.push(
          `回复标记 [进度 ${current}/${total}] 声称任务未完成，但 update_todos 清单已全部归位${cleared ? "（已清空）" : ""}`,
        );
      }
    } else if (incomplete > 0) {
      issues.push(
        `回复标记 [进度 ${current}/${total}] 声称任务完成，但 update_todos 清单仍有 ${incomplete} 项未完成（其中 ${inProgress} 项进行中）`,
      );
    }
    return issues;
  }

  if (incomplete > 0 && DONE_WORDS_RE.test(reply) && !NEGATION_RE.test(reply)) {
    issues.push(
      `回复称任务已收尾，但 update_todos 清单仍有 ${incomplete} 项未完成（其中 ${inProgress} 项进行中）；请先更新清单再收尾`,
    );
  }
  return issues;
}
