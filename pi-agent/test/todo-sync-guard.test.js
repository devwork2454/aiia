import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkTodoSync,
  extractReplyText,
  PROGRESS_RE,
} from "../src/todo-sync-guard.js";

describe("todo-sync-guard: checkTodoSync", () => {
  test("一致：清单有进行中 + 回复带中途进度标记 → 无问题", () => {
    const todos = [
      { id: "a", status: "completed" },
      { id: "b", status: "in_progress" },
      { id: "c", status: "pending" },
    ];
    const issues = checkTodoSync(todos, "[进度 2/3] 正在做第二步，摘要：xxx");
    assert.deepEqual(issues, []);
  });

  test("一致：清单全完成 + 回复 [进度 3/3] 收尾 → 无问题", () => {
    const todos = [
      { id: "a", status: "completed" },
      { id: "b", status: "completed" },
    ];
    const issues = checkTodoSync(todos, "[进度 2/2] 全部完成，一句话总结");
    assert.deepEqual(issues, []);
  });

  test("脱节 A：回复 [进度 2/3] 称未完，但清单已全部归位 → 检出", () => {
    const todos = [
      { id: "a", status: "completed" },
      { id: "b", status: "completed" },
    ];
    const issues = checkTodoSync(todos, "[进度 2/3] 还有一步，继续");
    assert.equal(issues.length, 1);
    assert.match(issues[0], /回复标记 \[进度 2\/3\] 声称任务未完成/);
  });

  test("脱节 B：回复 [进度 3/3] 称完成，但清单仍有进行中 → 检出", () => {
    const todos = [
      { id: "a", status: "completed" },
      { id: "b", status: "in_progress" },
    ];
    const issues = checkTodoSync(todos, "[进度 2/2] 任务完成，交付物如下");
    assert.equal(issues.length, 1);
    assert.match(issues[0], /声称任务完成，但 update_todos 清单仍有 1 项未完成/);
  });

  test("脱节 C：清单已清空，回复仍带中途标记 → 检出", () => {
    const issues = checkTodoSync([], "[进度 1/4] 进行中");
    assert.equal(issues.length, 1);
    assert.match(issues[0], /已清空/);
  });

  test("脱节 D：回复称已收尾（无标记），但清单有进行中 → 检出", () => {
    const todos = [
      { id: "a", status: "completed" },
      { id: "b", status: "in_progress" },
    ];
    const issues = checkTodoSync(todos, "任务全部完成，收工，交付清单如下");
    assert.equal(issues.length, 1);
    assert.match(issues[0], /回复称任务已收尾，但 update_todos 清单仍有 1 项未完成/);
  });

  test("无脱节：回复称收尾但带否定词（还有待办）→ 不误报", () => {
    const todos = [{ id: "b", status: "in_progress" }];
    const issues = checkTodoSync(todos, "核心已完成，但仍有待办未完成，继续推进");
    assert.deepEqual(issues, []);
  });

  test("空清单 + 无进度标记 + 回复无收尾词 → 不误报", () => {
    const issues = checkTodoSync([], "纯问答，不需要清单");
    assert.deepEqual(issues, []);
  });
});

describe("todo-sync-guard: extractReplyText", () => {
  test("字符串 content 原样返回", () => {
    assert.equal(extractReplyText({ content: "你好" }), "你好");
  });

  test("数组 content 拼接 text 字段", () => {
    const message = {
      content: [{ type: "text", text: "L1 核心" }, { type: "text", text: "视图" }],
    };
    assert.equal(extractReplyText(message), "L1 核心视图");
  });

  test("无 content → 空串", () => {
    assert.equal(extractReplyText({}), "");
    assert.equal(extractReplyText(undefined), "");
  });
});

describe("todo-sync-guard: 进度标记正则", () => {
  test("匹配 [进度 2/4]", () => {
    const m = "[进度 2/4]".match(PROGRESS_RE);
    assert.ok(m);
    assert.equal(m[1], "2");
    assert.equal(m[2], "4");
  });

  test("匹配 [进度2/4]（无空格）", () => {
    assert.ok("[进度2/4]".match(PROGRESS_RE));
  });
});
