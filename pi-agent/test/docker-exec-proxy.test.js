import test from "node:test";
import assert from "node:assert";
import dockerExecProxyExtension from "../extensions/docker-exec-proxy.js";

test("Docker Exec Proxy Extension Tests", async (t) => {
  // 模拟 Pi API 拦截注册
  const handlers = {};
  const piMock = {
    on(event, handler) {
      handlers[event] = handler;
    }
  };

  // 加载扩展
  dockerExecProxyExtension(piMock);

  await t.test("passes through when SWE_DOCKER_CONTAINER is not set", async () => {
    delete process.env.SWE_DOCKER_CONTAINER;
    const event = { toolName: "run_command", input: { command: "ls -la" } };
    await handlers.tool_call(event, {});
    assert.strictEqual(event.input.command, "ls -la");
  });

  await t.test("rewrites command when SWE_DOCKER_CONTAINER is set", async () => {
    process.env.SWE_DOCKER_CONTAINER = "swe-instance-12345";
    const event = { toolName: "run_command", input: { command: "ls -la", cwd: "/workspace" } };
    await handlers.tool_call(event, {});
    assert.strictEqual(
      event.input.command, 
      "docker exec -i -w /workspace swe-instance-12345 bash -c 'ls -la'"
    );
  });

  await t.test("escapes single quotes correctly", async () => {
    process.env.SWE_DOCKER_CONTAINER = "swe-instance-12345";
    const event = { toolName: "run_command", input: { command: "echo 'hello world'" } };
    await handlers.tool_call(event, {});
    assert.strictEqual(
      event.input.command, 
      "docker exec -i swe-instance-12345 bash -c 'echo '\\''hello world'\\'''"
    );
  });
});
