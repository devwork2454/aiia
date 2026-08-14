import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  transformGitHubCallouts,
  createMarkdownTransformer,
  isMarkdownTransformDisabled,
} from "../src/markdown-transform.js";
import markdownTransformExtension from "../extensions/markdown-transform.js";

describe("markdown-transform pure functions", () => {
  test("rewrites GitHub callout kinds into bold labeled lines", () => {
    assert.equal(transformGitHubCallouts("> [!NOTE] read the docs", {}), "> **📝 NOTE** read the docs");
    assert.equal(transformGitHubCallouts("> [!TIP] use a lock", {}), "> **💡 TIP** use a lock");
    assert.equal(transformGitHubCallouts("> [!IMPORTANT] this matters", {}), "> **⭐ IMPORTANT** this matters");
    assert.equal(transformGitHubCallouts("> [!WARNING] careful", {}), "> **⚠️ WARNING** careful");
    assert.equal(transformGitHubCallouts("> [!CAUTION] danger", {}), "> **⚠️ CAUTION** danger");
  });

  test("is case-insensitive and tolerates a missing body", () => {
    assert.equal(transformGitHubCallouts("> [!note] lower", {}), "> **📝 NOTE** lower");
    assert.equal(transformGitHubCallouts("> [!WARNING]", {}), "> **⚠️ WARNING**");
  });

  test("leaves non-callout lines and plain blockquotes untouched", () => {
    const md = "hello\n> just a quote\n```js\n> [!NOTE] inside code\n```";
    assert.equal(transformGitHubCallouts(md, {}), md);
  });

  test("keeps callout body continuation lines as-is", () => {
    const md = "> [!NOTE] header\n> continuation line";
    assert.equal(transformGitHubCallouts(md, {}), "> **📝 NOTE** header\n> continuation line");
  });

  test("kill switch AIIA_MARKDOWN_TRANSFORM_DISABLED returns original text", () => {
    const md = "> [!NOTE] x";
    assert.equal(transformGitHubCallouts(md, { AIIA_MARKDOWN_TRANSFORM_DISABLED: "1" }), md);
    assert.equal(isMarkdownTransformDisabled({ AIIA_MARKDOWN_TRANSFORM_DISABLED: "true" }), true);
    assert.equal(isMarkdownTransformDisabled({}), false);
  });

  test("createMarkdownTransformer returns a (markdown) => string function", () => {
    const transform = createMarkdownTransformer({});
    assert.equal(typeof transform, "function");
    assert.equal(transform("> [!TIP] go"), "> **💡 TIP** go");
    assert.equal(transform("no callout"), "no callout");
  });
});

describe("markdown-transform extension", () => {
  test("registers a markdown transformer that rewrites callouts", () => {
    let captured = null;
    markdownTransformExtension({
      registerMarkdownTransformer: (fn) => {
        captured = fn;
      },
    });
    assert.equal(typeof captured, "function");
    assert.equal(captured("> [!CAUTION] hot"), "> **⚠️ CAUTION** hot");
    assert.equal(captured("plain"), "plain");
  });
});
