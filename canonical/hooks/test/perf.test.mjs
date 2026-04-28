// p99 < 5ms target (kickoff §F): the synchronous hot path of PreToolUse —
// readCache + verify + scope + cooldown — must stay under 5ms at the 99th
// percentile across 1000 iterations.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";

import { _setPublicKeyForTesting } from "../lib/jwt-verify.mjs";
import { _setCachePathsForTesting, writeCache } from "../lib/cache.mjs";
import {
  _setStdinForTesting,
  _setAgntuxRootForTesting,
  _setPluginSlugsForTesting,
} from "../lib/scope.mjs";
import { decide, _setSpawnForTesting } from "../license-validate.mjs";
import { readCache } from "../lib/cache.mjs";
import { isAgntuxScoped } from "../lib/scope.mjs";
import { getTestKeys, mintJwt, defaultClaims } from "./fixtures/test-key.mjs";

_setPublicKeyForTesting(getTestKeys().publicKeyPem, "agntux-license-v1");
// Stub spawn so the perf test never forks a real process.
_setSpawnForTesting(() => ({ unref() {} }));

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "agntux-perf-test-"));
  const file = join(dir, ".license");
  _setCachePathsForTesting(dir, file);
  _setPluginSlugsForTesting(["agntux-core"]);
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

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}

test("PreToolUse hot path: p99 < 5ms over 1000 iterations", () => {
  const { dir } = setup();
  try {
    // Seed cache with a valid token.
    const claims = defaultClaims({ exp: Math.floor(Date.now() / 1000) + 24 * 3600 });
    writeCache({ token: mintJwt(claims), expires_at: claims.exp });
    const ctx = { tool_name: "mcp__agntux-core__do_x" };

    // Warm-up: prime the public-key cache, hot-load filesystem caches.
    for (let i = 0; i < 50; i++) {
      const cached = readCache();
      decide(ctx, cached, Math.floor(Date.now() / 1000));
    }

    const N = 1000;
    const samples = new Array(N);
    for (let i = 0; i < N; i++) {
      const t0 = process.hrtime.bigint();
      // The shape of the actual hot path (per license-validate.mjs main):
      //   1) isAgntuxScoped(ctx)
      //   2) readCache()
      //   3) decide(ctx, cached, now)  (which calls verifyLicense)
      isAgntuxScoped(ctx);
      const cached = readCache();
      decide(ctx, cached, Math.floor(Date.now() / 1000));
      const t1 = process.hrtime.bigint();
      samples[i] = Number(t1 - t0) / 1e6; // ms
    }

    const p50 = percentile(samples, 0.5);
    const p99 = percentile(samples, 0.99);
    const p999 = percentile(samples, 0.999);
    const max = Math.max(...samples);
    // eslint-disable-next-line no-console
    console.log(`[perf] p50=${p50.toFixed(3)}ms p99=${p99.toFixed(3)}ms p999=${p999.toFixed(3)}ms max=${max.toFixed(3)}ms`);
    // Record p99 in a side-channel for the harness to grep.
    process.stderr.write(`PERF_P99_MS=${p99.toFixed(3)}\n`);
    assert.ok(p99 < 5, `p99 ${p99}ms exceeds 5ms target`);
  } finally { cleanup(dir); }
});

test("PreToolUse out-of-scope path: p99 < 1ms (early return)", () => {
  const { dir } = setup();
  try {
    const ctx = { tool_name: "Bash", tool_input: { command: "ls" } };
    // warmup
    for (let i = 0; i < 50; i++) isAgntuxScoped(ctx);
    const N = 1000;
    const samples = new Array(N);
    for (let i = 0; i < N; i++) {
      const t0 = process.hrtime.bigint();
      isAgntuxScoped(ctx); // true short-circuit, no cache read at all
      const t1 = process.hrtime.bigint();
      samples[i] = Number(t1 - t0) / 1e6;
    }
    const p99 = percentile(samples, 0.99);
    // eslint-disable-next-line no-console
    console.log(`[perf-oos] p99=${p99.toFixed(4)}ms`);
    assert.ok(p99 < 1, `out-of-scope p99 ${p99}ms exceeds 1ms`);
  } finally { cleanup(dir); }
});
