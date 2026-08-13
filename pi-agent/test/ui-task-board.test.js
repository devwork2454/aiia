/**
 * ui-task-board: custom checklist renderer must only use real theme color keys.
 * Regression for silent fallback to default [checklist] + raw JSON.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, it, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "../node_modules/@earendil-works/pi-coding-agent");
const nestedReq = createRequire(path.join(pkgRoot, "dist/core/extensions/loader.js"));
const piTuiEntry = nestedReq.resolve("@earendil-works/pi-tui");
const darkTheme = JSON.parse(
  fs.readFileSync(path.join(pkgRoot, "dist/modes/interactive/theme/dark.json"), "utf8"),
);
const VALID_COLORS = new Set(Object.keys(darkTheme.colors));

// Pi injects pi-tui via jiti aliases; node:test needs an equivalent resolver.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === "@earendil-works/pi-tui") {
        return {
          shortCircuit: true,
          url: ${JSON.stringify(pathToFileURL(piTuiEntry).href)},
          format: "module",
        };
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
);

describe("ui-task-board", () => {
  let factory;

  before(async () => {
    delete process.env.AIIA_VISUAL_DISABLED;
    const extPath = path.resolve(__dirname, "../extensions/ui-task-board.js");
    factory = (await import(pathToFileURL(extPath).href)).default;
  });

  function loadExtension() {
    let renderer;
    const commands = {};
    const tools = {};
    const hooks = {};
    let lastMessage;
    const pi = {
      on(event, fn) {
        hooks[event] = fn;
      },
      registerMessageRenderer(type, fn) {
        renderer = { type, fn };
      },
      registerCommand(name, def) {
        commands[name] = def;
      },
      registerTool(def) {
        tools[def.name] = def;
      },
      sendMessage(msg) {
        lastMessage = msg;
      },
    };
    factory(pi);
    return {
      renderer,
      command: { name: "demo-board", def: commands["demo-board"] },
      commands,
      tools,
      hooks,
      getLastMessage: () => lastMessage,
    };
  }

  function makeTheme() {
    return {
      fg(color, text) {
        if (!VALID_COLORS.has(color)) {
          throw new Error(`Unknown theme color: ${color}`);
        }
        return `[${color}]${text}`;
      },
    };
  }

  it("registers checklist renderer, demo-board, and update_todos", () => {
    const { renderer, command, tools } = loadExtension();
    assert.equal(renderer.type, "checklist");
    assert.equal(command.name, "demo-board");
    assert.equal(typeof renderer.fn, "function");
    assert.equal(typeof command.def.handler, "function");
    assert.equal(typeof tools.update_todos.execute, "function");
  });

  it("renders task pipeline without throwing on dark theme colors", () => {
    const { renderer } = loadExtension();
    const theme = makeTheme();
    const stages = [
      { task: "分析系统架构依赖", status: "done" },
      { task: "挂载 React/Ink 渲染引擎", status: "done" },
      { task: "编译并绑定原生终端画笔", status: "doing" },
      { task: "启动后台进程服务", status: "pending" },
    ];
    const component = renderer.fn(
      { customType: "checklist", content: JSON.stringify(stages), display: true },
      { expanded: false, outputPad: 1 },
      theme,
    );
    assert.ok(component, "renderer must return a component (not undefined fallback)");
    assert.equal(component.constructor?.name, "VStack");
  });

  it("returns undefined on invalid JSON so default renderer can take over", () => {
    const { renderer } = loadExtension();
    assert.equal(renderer.fn({ content: "not-json" }, {}, makeTheme()), undefined);
  });

  it("demo-board sends display:true boolean (not string 'show')", async () => {
    const { command, getLastMessage } = loadExtension();
    await command.def.handler("", {});
    const msg = getLastMessage();
    assert.equal(msg.customType, "checklist");
    assert.equal(msg.display, true);
    assert.equal(typeof msg.display, "boolean");
    const stages = JSON.parse(msg.content);
    assert.equal(stages.length, 9);
    assert.equal(stages[2].status, "in_progress");
  });

  it("update_todos paints the above-editor widget", async () => {
    const { tools } = loadExtension();
    const widgets = new Map();
    const ctx = {
      ui: {
        setWidget(key, content) {
          if (content === undefined) widgets.delete(key);
          else widgets.set(key, content);
        },
      },
    };
    const result = await tools.update_todos.execute(
      "tc1",
      {
        todos: [
          { content: "SDD 工作区 / worktree / ledger", status: "completed" },
          { content: "Task 2: watermark 单调合并", status: "in_progress" },
          { content: "Task 3: 0 行不 REPLACE", status: "pending" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    const lines = widgets.get("todo-progress");
    assert.equal(lines[0], "To-do Working on 3 to-dos • 1 done");
    assert.match(result.content[0].text, /◐ Task 2/);
    await tools.update_todos.execute("tc2", { clear: true }, undefined, undefined, ctx);
    assert.equal(widgets.has("todo-progress"), false);
  });

  it("source does not use primary/secondary theme keys", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../extensions/ui-task-board.js"), "utf8");
    assert.equal(/theme\.fg\(\s*["'](primary|secondary)["']/.test(src), false);
    assert.equal(/display:\s*["']show["']/.test(src), false);
  });

  it("factory is a no-op when AIIA_VISUAL_DISABLED=1", () => {
    const prev = process.env.AIIA_VISUAL_DISABLED;
    process.env.AIIA_VISUAL_DISABLED = "1";
    try {
      let renderer;
      factory({
        registerMessageRenderer(type, fn) {
          renderer = { type, fn };
        },
        registerCommand() {},
      });
      assert.equal(renderer, undefined);
    } finally {
      if (prev === undefined) delete process.env.AIIA_VISUAL_DISABLED;
      else process.env.AIIA_VISUAL_DISABLED = prev;
    }
  });
});
