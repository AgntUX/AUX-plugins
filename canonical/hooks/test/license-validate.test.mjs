import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";

import { _setPublicKeyForTesting } from "../lib/jwt-verify.mjs";
import { _setCachePathsForTesting } from "../lib/cache.mjs";
import {
  _setStdinForTesting,
  _setAgntuxRootForTesting,
  _setPluginSlugsForTesting,
} from "../lib/scope.mjs";
import {
  decide,
  maybeSpawnBgRefresh,
  _setSpawnForTesting,
} from "../license-validate.mjs";
import { getTestKeys, mintJwt, defaultClaims } from "./fixtures/test-key.mjs";

_setPublicKeyForTesting(getTestKeys().publicKeyPem, "agntux-license-v1");

const TEST_SLUGS = ["agntux-core", "slack-ingest"];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "agntux-validate-test-"));
  const file = join(dir, ".license");
  _setCachePathsForTesting(dir, file);
  _setPluginSlugsForTesting(TEST_SLUGS);
  _setAgntuxRootForTesting(resolve(homedir(), "agntux"));
  return { dir, file };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  _setCachePathsForTesting(null, null);
  _setPluginSlugsForTesting(null);
  _setAgntuxRootForTesting(null);
  _setStdinForTesting(null);
  _setSpawnForTesting(null);
}

test("decide: out-of-scope tool call -> allow without consulting cache", () => {
  const { dir } = setup();
  try {
    const ctx = { tool_name: "Bash", tool_input: { command: "ls" } };
    const r = decide(ctx, null, Math.floor(Date.now() / 1000));
    assert.equal(r.action, "allow");
    assert.equal(r.out_of_scope, true);
  } finally { cleanup(dir); }
});

test("decide: in-scope MCP tool with valid cache -> allow", () => {
  const { dir } = setup();
  try {
    const claims = defaultClaims();
    const cached = { token: mintJwt(claims), expires_at: claims.exp };
    const ctx = { tool_name: "mcp__agntux-core__do_x" };
    const r = decide(ctx, cached, claims.iat + 10);
    assert.equal(r.action, "allow");
    assert.ok(r.payload);
  } finally { cleanup(dir); }
});

test("decide: in-scope MCP tool with no cache -> block", () => {
  const { dir } = setup();
  try {
    const ctx = { tool_name: "mcp__agntux-core__do_x" };
    const r = decide(ctx, null, Math.floor(Date.now() / 1000));
    assert.equal(r.action, "block");
    assert.match(r.reason, /No valid licence cached/);
  } finally { cleanup(dir); }
});

test("decide: in-scope MCP tool with corrupt cache -> block", () => {
  const { dir } = setup();
  try {
    const ctx = { tool_name: "mcp__agntux-core__do_x" };
    const r = decide(ctx, { _corrupt: true, error: "x" }, Math.floor(Date.now() / 1000));
    assert.equal(r.action, "block");
  } finally { cleanup(dir); }
});

test("decide: in-scope MCP tool with expired token -> block (zero-grace P2.AMEND.3)", () => {
  const { dir } = setup();
  try {
    const now = Math.floor(Date.now() / 1000);
    const claims = defaultClaims({ iat: now - 7200, nbf: now - 7200, exp: now - 3600 });
    const cached = { token: mintJwt(claims), expires_at: claims.exp };
    const ctx = { tool_name: "mcp__agntux-core__do_x" };
    const r = decide(ctx, cached, now);
    assert.equal(r.action, "block");
    assert.match(r.reason, /expired/i);
  } finally { cleanup(dir); }
});

test("decide: in-scope MCP tool with bad signature -> block", () => {
  const { dir } = setup();
  try {
    const cached = { token: "garbage.token.here", expires_at: 1 };
    const ctx = { tool_name: "mcp__agntux-core__do_x" };
    const r = decide(ctx, cached, Math.floor(Date.now() / 1000));
    assert.equal(r.action, "block");
    assert.match(r.reason, /Licence invalid/);
  } finally { cleanup(dir); }
});

test("maybeSpawnBgRefresh: skips when remaining > 30 min", () => {
  const { dir } = setup();
  try {
    let spawned = false;
    _setSpawnForTesting(() => { spawned = true; return { unref() {} }; });
    const now = Math.floor(Date.now() / 1000);
    const cached = { token: "x", expires_at: now + 3600 };
    const payload = { exp: now + 3600 };
    const result = maybeSpawnBgRefresh(cached, payload, now);
    assert.equal(result, false);
    assert.equal(spawned, false);
  } finally { cleanup(dir); }
});

test("maybeSpawnBgRefresh: spawns when remaining < 30 min and no cooldown", () => {
  const { dir } = setup();
  try {
    let spawnCalls = 0;
    let argsSeen = null;
    _setSpawnForTesting((cmd, args, opts) => {
      spawnCalls++;
      argsSeen = { cmd, args, opts };
      return { unref() {} };
    });
    const now = Math.floor(Date.now() / 1000);
    // Need a cached token first (writeCache will be called inside)
    writeFileSync(join(dir, ".license"), JSON.stringify({ token: "x" }));
    const cached = { token: "x", expires_at: now + 600, last_refresh_attempt_at: 0 };
    const payload = { exp: now + 600 };
    const result = maybeSpawnBgRefresh(cached, payload, now);
    assert.equal(result, true);
    assert.equal(spawnCalls, 1);
    assert.equal(argsSeen.cmd, "node");
    assert.ok(argsSeen.args[0].endsWith("license-check.mjs"));
    assert.equal(argsSeen.args[1], "--silent");
    assert.equal(argsSeen.opts.detached, true);
    assert.equal(argsSeen.opts.stdio, "ignore");
  } finally { cleanup(dir); }
});

test("maybeSpawnBgRefresh: cooldown blocks repeated spawns within 60s", () => {
  const { dir } = setup();
  try {
    let spawnCalls = 0;
    _setSpawnForTesting(() => { spawnCalls++; return { unref() {} }; });
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(join(dir, ".license"), JSON.stringify({ token: "x" }));
    const cached = { token: "x", expires_at: now + 600, last_refresh_attempt_at: now - 30 };
    const payload = { exp: now + 600 };
    const result = maybeSpawnBgRefresh(cached, payload, now);
    assert.equal(result, false);
    assert.equal(spawnCalls, 0);
  } finally { cleanup(dir); }
});

test("maybeSpawnBgRefresh: cooldown elapsed (>60s) -> spawn allowed", () => {
  const { dir } = setup();
  try {
    let spawnCalls = 0;
    _setSpawnForTesting(() => { spawnCalls++; return { unref() {} }; });
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(join(dir, ".license"), JSON.stringify({ token: "x" }));
    const cached = { token: "x", expires_at: now + 600, last_refresh_attempt_at: now - 90 };
    const payload = { exp: now + 600 };
    const result = maybeSpawnBgRefresh(cached, payload, now);
    assert.equal(result, true);
    assert.equal(spawnCalls, 1);
  } finally { cleanup(dir); }
});

test("decide: file Write under ~/agntux-code/ with valid cache -> allow", () => {
  const { dir } = setup();
  try {
    const claims = defaultClaims();
    const cached = { token: mintJwt(claims), expires_at: claims.exp };
    const fp = resolve(homedir(), "agntux", "entities", "x.md");
    const ctx = { tool_name: "Write", tool_input: { file_path: fp } };
    const r = decide(ctx, cached, claims.iat + 10);
    assert.equal(r.action, "allow");
  } finally { cleanup(dir); }
});

test("decide: file Write outside ~/agntux-code/ -> allow (out of scope) regardless of cache", () => {
  const { dir } = setup();
  try {
    const fp = resolve(homedir(), "projects", "my-app", "src", "x.ts");
    const ctx = { tool_name: "Write", tool_input: { file_path: fp } };
    const r = decide(ctx, null, Math.floor(Date.now() / 1000));
    assert.equal(r.action, "allow");
    assert.equal(r.out_of_scope, true);
  } finally { cleanup(dir); }
});
