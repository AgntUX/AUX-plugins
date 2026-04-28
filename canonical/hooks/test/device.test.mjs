import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getOrCreateDeviceId,
  _setDevicePathsForTesting,
  _setHostnameForTesting,
} from "../lib/device.mjs";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "agntux-device-test-"));
  const file = join(dir, ".device");
  _setDevicePathsForTesting(dir, file);
  _setHostnameForTesting("test-host.example.com");
  return { dir, file };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  _setDevicePathsForTesting(null, null);
  _setHostnameForTesting(null);
}

test("getOrCreateDeviceId: mints a new ID when none exists", () => {
  const { dir, file } = setup();
  try {
    const id = getOrCreateDeviceId();
    assert.match(id, /^dev_[a-f0-9]{16}$/);
    const onDisk = readFileSync(file, "utf8").trim();
    assert.equal(onDisk, id);
  } finally { cleanup(dir); }
});

test("getOrCreateDeviceId: returns persisted ID on second call", () => {
  const { dir } = setup();
  try {
    const a = getOrCreateDeviceId();
    const b = getOrCreateDeviceId();
    assert.equal(a, b);
  } finally { cleanup(dir); }
});

test("getOrCreateDeviceId: writes file at 0600", () => {
  if (process.platform === "win32") return;
  const { dir, file } = setup();
  try {
    getOrCreateDeviceId();
    const st = statSync(file);
    assert.equal(st.mode & 0o777, 0o600);
  } finally { cleanup(dir); }
});

test("getOrCreateDeviceId: creates parent dir 0700", () => {
  if (process.platform === "win32") return;
  const { dir } = setup();
  try {
    rmSync(dir, { recursive: true, force: true });
    getOrCreateDeviceId();
    const st = statSync(dir);
    assert.equal(st.mode & 0o777, 0o700);
  } finally { cleanup(dir); }
});

test("getOrCreateDeviceId: re-mints if persisted ID is malformed", () => {
  const { dir, file } = setup();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "not-a-valid-id");
    const id = getOrCreateDeviceId();
    assert.match(id, /^dev_[a-f0-9]{16}$/);
  } finally { cleanup(dir); }
});

test("getOrCreateDeviceId: same hostname + same nonce-file yields stable ID", () => {
  const { dir } = setup();
  try {
    const a = getOrCreateDeviceId();
    // same hostname override, same persisted file
    const b = getOrCreateDeviceId();
    assert.equal(a, b);
  } finally { cleanup(dir); }
});

test("getOrCreateDeviceId: different hostnames produce different IDs", () => {
  const { dir } = setup();
  try {
    const a = getOrCreateDeviceId();
    // wipe and switch hostname
    rmSync(dir, { recursive: true, force: true });
    _setHostnameForTesting("other-host.example.com");
    const b = getOrCreateDeviceId();
    assert.notEqual(a, b);
  } finally { cleanup(dir); }
});
