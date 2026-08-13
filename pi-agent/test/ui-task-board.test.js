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
import { enableAllExtensions } from "./with-all-extensions.js";
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
    enableAllExtensions();
    const extPath = path.resolve(__dirname, "../extensions/ui-task-board.js");
    factory = (await import(pathToFileURL(extPath).href)).default;
  });

  function loadExtension() {
    let renderer;
    let command;
    let lastMessage;
    const pi = {
      registerMessageRenderer(type, fn) {
        renderer = { type, fn };
      },
      registerCommand(name, def) {
        command = { name, def };
      },
      sendMessage(msg) {
        lastMessage = msg;
      },
    };
    factory(pi);
    return {
      renderer,
      command,
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

  it("registers checklist renderer and demo-board command", () => {
    const { renderer, command } = loadExtension();
    assert.equal(renderer.type, "checklist");
    assert.equal(command.name, "demo-board");
    assert.equal(typeof renderer.fn, "function");
    assert.equal(typeof command.def.handler, "function");
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
    assert.equal(stages.length, 4);
    assert.equal(stages[2].status, "doing");
  });

  it("source does not use primary/secondary theme keys", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../extensions/ui-task-board.js"), "utf8");
    assert.equal(/theme\.fg\(\s*["'](primary|secondary)["']/.test(src), false);
    assert.equal(/display:\s*["']show["']/.test(src), false);
  });
});
