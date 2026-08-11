import url from 'url';
import path from 'path';

// Fix for __dirname in ESM
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

import microContextExtension from '../pi-agent/extensions/micro-context.js';

const mockPi = {
  events: {},
  registerTool(t) { this.tool = t; },
  on(evt, handler) { this.events[evt] = handler; }
};

microContextExtension(mockPi);

const ctx = {
  cwd: __dirname,
  hasUI: true,
  ui: {
    confirm: async (title, body) => {
      console.log(`[UI 弹窗触发] ${title}`);
      console.log(body);
      return false; // 模拟用户点击拒绝
    }
  }
};

async function runTest() {
  console.log("======================================");
  console.log("测试 1：发送超过 2000 字符的冗长日志");
  const longMsg = "This is a very long log line...\n".repeat(80); // ~2500 chars
  let res = await mockPi.events["tool_call"]({ toolName: "send_message", input: { message: longMsg } }, ctx);
  console.log("拦截结果：", res);

  console.log("\n======================================");
  console.log("测试 2：发送中等长度（800 字符）但不含规范格式的废话");
  const badMsg = "Hi, I have investigated the problem. It seems the error is caused by a null pointer... " + "blah ".repeat(160);
  res = await mockPi.events["tool_call"]({ toolName: "send_message", input: { message: badMsg } }, ctx);
  console.log("拦截结果：", res);

  console.log("\n======================================");
  console.log("测试 3：发送规范的微上下文（Diff 结构）");
  const goodMsg = "```diff\n- old_code\n+ new_code\n```";
  res = await mockPi.events["tool_call"]({ toolName: "send_message", input: { message: goodMsg } }, ctx);
  console.log("拦截结果：", res ? res : "未拦截，通行正常 (PASS)");
  console.log("======================================");
}

runTest();
