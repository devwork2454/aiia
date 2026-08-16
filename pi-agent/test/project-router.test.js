import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProjectRoutingSnapshot,
  buildProjectRoutingTable,
  isProjectRouterDisabled,
  scanProjects,
} from "../src/project-router.js";

test("scanProjects lists project dirs with metadata", () => {
  const projects = scanProjects({ root: process.env.HOME + "/project" });
  assert.ok(Array.isArray(projects));
  assert.ok(projects.length > 0, "expected at least one project under ~/project");
  const aiia = projects.find((p) => p.name === "aiia");
  assert.ok(aiia, "aiia project must be scanned");
  assert.ok(aiia.path.endsWith("/aiia"));
  assert.equal(typeof aiia.desc, "string");
  assert.ok(Array.isArray(aiia.stack));
});

test("buildProjectRoutingTable contains paths and routing directive source data", () => {
  const table = buildProjectRoutingTable({ root: process.env.HOME + "/project" });
  assert.ok(table.length > 0);
  assert.ok(table.includes("/home/") || table.includes("/Users/"), "paths must be absolute");
});

test("buildProjectRoutingSnapshot disabled by env", () => {
  const env = { AIIA_PROJECT_ROUTER_DISABLED: "1" };
  assert.equal(isProjectRouterDisabled(env), true);
  assert.equal(buildProjectRoutingSnapshot({ root: process.env.HOME + "/project", env }), "");
});

test("buildProjectRoutingSnapshot is bounded", () => {
  const body = buildProjectRoutingSnapshot({ root: process.env.HOME + "/project" });
  assert.ok(body.length <= 4096, `snapshot too long: ${body.length}`);
  assert.ok(body.includes("[AIIA 项目路由表]"));
});

test("missing root returns empty table", () => {
  assert.equal(buildProjectRoutingTable({ root: "/nonexistent/definitely-missing" }), "");
});
