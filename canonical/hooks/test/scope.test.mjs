import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  isAgntuxScoped,
  readToolContext,
  _setAgntuxRootForTesting,
  _setStdinForTesting,
  _setPluginSlugsForTesting,
} from "../lib/scope.mjs";

const TEST_SLUGS = ["agntux-core", "slack-ingest", "gmail-ingest"];

function setupSlugs() {
  _setPluginSlugsForTesting(TEST_SLUGS);
  _setAgntuxRootForTesting(resolve(homedir(), "agntux"));
}

function teardown() {
  _setPluginSlugsForTesting(null);
  _setAgntuxRootForTesting(null);
  _setStdinForTesting(null);
}

test("isAgntuxScoped: null/undefined ctx -> conservative true", () => {
  setupSlugs();
  try {
    assert.equal(isAgntuxScoped(null), true);
    assert.equal(isAgntuxScoped(undefined), true);
  } finally { teardown(); }
});

test("isAgntuxScoped: ctx with no tool_name -> conservative true", () => {
  setupSlugs();
  try {
    assert.equal(isAgntuxScoped({}), true);
    assert.equal(isAgntuxScoped({ tool_name: null }), true);
  } finally { teardown(); }
});

test("isAgntuxScoped: mcp__agntux-core__do_x -> true (in slug list)", () => {
  setupSlugs();
  try {
    assert.equal(isAgntuxScoped({ tool_name: "mcp__agntux-core__do_x" }), true);
    assert.equal(isAgntuxScoped({ tool_name: "mcp__slack-ingest__fetch" }), true);
  } finally { teardown(); }
});

test("isAgntuxScoped: mcp__other-plugin__tool -> false", () => {
  setupSlugs();
  try {
    assert.equal(isAgntuxScoped({ tool_name: "mcp__some-other__do_x" }), false);
  } finally { teardown(); }
});

test("isAgntuxScoped: Write under ~/agntux-code/ -> true", () => {
  setupSlugs();
  try {
    const fp = resolve(homedir(), "agntux", "entities", "acme.md");
    assert.equal(isAgntuxScoped({ tool_name: "Write", tool_input: { file_path: fp } }), true);
  } finally { teardown(); }
});

test("isAgntuxScoped: Write under ~/elsewhere/ -> false (perf escape valve)", () => {
  setupSlugs();
  try {
    const fp = resolve(homedir(), "projects", "my-app", "src", "index.ts");
    assert.equal(isAgntuxScoped({ tool_name: "Write", tool_input: { file_path: fp } }), false);
    assert.equal(isAgntuxScoped({ tool_name: "Edit", tool_input: { file_path: fp } }), false);
  } finally { teardown(); }
});

test("isAgntuxScoped: Write to /tmp -> false", () => {
  setupSlugs();
  try {
    assert.equal(isAgntuxScoped({ tool_name: "Write", tool_input: { file_path: "/tmp/foo.txt" } }), false);
  } finally { teardown(); }
});

test("isAgntuxScoped: Write missing file_path -> false", () => {
  setupSlugs();
  try {
    assert.equal(isAgntuxScoped({ tool_name: "Write", tool_input: {} }), false);
    assert.equal(isAgntuxScoped({ tool_name: "Write" }), false);
  } finally { teardown(); }
});

test("isAgntuxScoped: trailing-separator boundary (~/agntux2/ NOT in scope)", () => {
  // Critical: AGNTUX_ROOT has trailing sep so `~/agntux2/foo` doesn't match.
  setupSlugs();
  try {
    const fp = resolve(homedir(), "agntux2", "foo.md");
    assert.equal(isAgntuxScoped({ tool_name: "Write", tool_input: { file_path: fp } }), false);
  } finally { teardown(); }
});

test("isAgntuxScoped: unknown tool name (e.g., Bash) -> false", () => {
  setupSlugs();
  try {
    assert.equal(isAgntuxScoped({ tool_name: "Bash", tool_input: { command: "ls" } }), false);
    assert.equal(isAgntuxScoped({ tool_name: "RandomTool" }), false);
  } finally { teardown(); }
});

test("isAgntuxScoped: malformed mcp__ name (no tool suffix) -> rejects unknown slug", () => {
  setupSlugs();
  try {
    assert.equal(isAgntuxScoped({ tool_name: "mcp__unknownslug" }), false);
    assert.equal(isAgntuxScoped({ tool_name: "mcp__" }), false);
  } finally { teardown(); }
});

test("readToolContext: parses valid JSON from stdin override", () => {
  setupSlugs();
  try {
    _setStdinForTesting(JSON.stringify({ tool_name: "Write", tool_input: { file_path: "/x" } }));
    const ctx = readToolContext();
    assert.equal(ctx.tool_name, "Write");
  } finally { teardown(); }
});

test("readToolContext: empty stdin returns empty ctx", () => {
  setupSlugs();
  try {
    _setStdinForTesting("");
    const ctx = readToolContext();
    assert.equal(ctx.tool_name, null);
  } finally { teardown(); }
});

test("readToolContext: garbage stdin returns empty ctx", () => {
  setupSlugs();
  try {
    _setStdinForTesting("{not json");
    const ctx = readToolContext();
    assert.equal(ctx.tool_name, null);
  } finally { teardown(); }
});
