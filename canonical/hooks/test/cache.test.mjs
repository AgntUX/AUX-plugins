import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync, chmodSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readCache,
  writeCache,
  cachePath,
  _setCachePathsForTesting,
} from "../lib/cache.mjs";

function newTempDir() {
  return mkdtempSync(join(tmpdir(), "agntux-cache-test-"));
}

function setupTempCache() {
  const dir = newTempDir();
  const file = join(dir, ".license");
  _setCachePathsForTesting(dir, file);
  return { dir, file };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  _setCachePathsForTesting(null, null);
}

test("readCache: returns null when file missing", () => {
  const { dir } = setupTempCache();
  try {
    assert.equal(readCache(), null);
  } finally { cleanup(dir); }
});

test("readCache: returns parsed object when file present and valid", () => {
  const { dir, file } = setupTempCache();
  try {
    writeFileSync(file, JSON.stringify({ token: "abc", expires_at: 1 }));
    const r = readCache();
    assert.equal(r.token, "abc");
    assert.equal(r.expires_at, 1);
  } finally { cleanup(dir); }
});

test("readCache: returns _corrupt on invalid JSON", () => {
  const { dir, file } = setupTempCache();
  try {
    writeFileSync(file, "{not json");
    const r = readCache();
    assert.equal(r._corrupt, true);
    assert.ok(typeof r.error === "string");
  } finally { cleanup(dir); }
});

test("readCache: returns _corrupt when token field missing", () => {
  const { dir, file } = setupTempCache();
  try {
    writeFileSync(file, JSON.stringify({ expires_at: 1 }));
    const r = readCache();
    assert.equal(r._corrupt, true);
  } finally { cleanup(dir); }
});

test("readCache: returns _corrupt when JSON is non-object (array)", () => {
  const { dir, file } = setupTempCache();
  try {
    writeFileSync(file, JSON.stringify(["a","b"]));
    const r = readCache();
    assert.equal(r._corrupt, true);
  } finally { cleanup(dir); }
});

test("writeCache: creates parent dir 0700", () => {
  const { dir } = setupTempCache();
  try {
    // Remove the dir to test creation
    rmSync(dir, { recursive: true, force: true });
    writeCache({ token: "t", expires_at: 1 });
    const st = statSync(dir);
    assert.ok(st.isDirectory());
    if (process.platform !== "win32") {
      assert.equal(st.mode & 0o777, 0o700);
    }
  } finally { cleanup(dir); }
});

test("writeCache: writes file at 0600", () => {
  const { dir, file } = setupTempCache();
  try {
    writeCache({ token: "t", expires_at: 1 });
    const st = statSync(file);
    if (process.platform !== "win32") {
      assert.equal(st.mode & 0o777, 0o600);
    }
  } finally { cleanup(dir); }
});

test("writeCache: re-chmods to 0600 even if file pre-existed at 0644", () => {
  if (process.platform === "win32") return; // skip on Windows
  const { dir, file } = setupTempCache();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "{}", { mode: 0o644 });
    chmodSync(file, 0o644);
    writeCache({ token: "t", expires_at: 1 });
    const st = statSync(file);
    assert.equal(st.mode & 0o777, 0o600);
  } finally { cleanup(dir); }
});

test("writeCache: tightens parent dir mode if drifted to 0755", () => {
  if (process.platform === "win32") return;
  const { dir } = setupTempCache();
  try {
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    chmodSync(dir, 0o755);
    writeCache({ token: "t", expires_at: 1 });
    const st = statSync(dir);
    assert.equal(st.mode & 0o777, 0o700);
  } finally { cleanup(dir); }
});

test("writeCache: atomic — temp file is removed after rename", () => {
  const { dir } = setupTempCache();
  try {
    writeCache({ token: "t", expires_at: 1 });
    // Only `.license` should exist; no .tmp.* leftovers
    const entries = readdirSync(dir);
    assert.deepEqual(entries.filter((e) => e.includes(".tmp.")).length, 0);
  } finally { cleanup(dir); }
});

test("readCache + writeCache roundtrip", () => {
  const { dir } = setupTempCache();
  try {
    const rec = {
      token: "eyJabc.def.ghi",
      expires_at: 12345,
      last_refresh_at: 1000,
      user_id: "usr_x",
      plan: "trial",
      signed_ui_base_url: "https://example.com/?sig=xyz",
      render_token: "eyJrender.token.here",
    };
    writeCache(rec);
    const r = readCache();
    assert.deepEqual(r, rec);
  } finally { cleanup(dir); }
});

test("writeCache rejects non-object", () => {
  const { dir } = setupTempCache();
  try {
    assert.throws(() => writeCache(null), TypeError);
    assert.throws(() => writeCache("token"), TypeError);
  } finally { cleanup(dir); }
});

test("cachePath returns the override when set", () => {
  const { dir, file } = setupTempCache();
  try {
    assert.equal(cachePath(), file);
  } finally { cleanup(dir); }
});
