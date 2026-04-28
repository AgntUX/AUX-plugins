import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import { _setPublicKeyForTesting } from "../lib/jwt-verify.mjs";
import { _setCachePathsForTesting, readCache, writeCache } from "../lib/cache.mjs";
import {
  _setDevicePathsForTesting,
  _setHostnameForTesting,
} from "../lib/device.mjs";
import {
  _setSessionPathForTesting,
  _setHttpsRequestForTesting,
} from "../lib/refresh.mjs";
import { main as runCheck } from "../license-check.mjs";
import { getTestKeys, mintJwt, defaultClaims } from "./fixtures/test-key.mjs";

_setPublicKeyForTesting(getTestKeys().publicKeyPem, "agntux-license-v1");

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "agntux-check-test-"));
  const cacheFile = join(dir, ".license");
  const deviceFile = join(dir, ".device");
  const sessionFile = join(dir, ".session");
  _setCachePathsForTesting(dir, cacheFile);
  _setDevicePathsForTesting(dir, deviceFile);
  _setSessionPathForTesting(sessionFile);
  _setHostnameForTesting("test-host");
  return { dir, cacheFile, deviceFile, sessionFile };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  _setCachePathsForTesting(null, null);
  _setDevicePathsForTesting(null, null);
  _setSessionPathForTesting(null);
  _setHostnameForTesting(null);
  _setHttpsRequestForTesting(null);
}

function fakeRequest({ statusCode, body }) {
  return (url, options, cb) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      cb(res);
      setImmediate(() => {
        if (body) res.emit("data", body);
        res.emit("end");
      });
    };
    req.destroy = () => {};
    return req;
  };
}

function fakeRequestNetworkError() {
  return (url, options, cb) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => setImmediate(() => req.emit("error", Object.assign(new Error("net"), { code: "ECONNREFUSED" })));
    req.destroy = () => {};
    return req;
  };
}

// Capture stderr noise so test runner output stays clean.
function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = (chunk) => { captured += chunk; return true; };
  return fn().finally(() => { process.stderr.write = original; }).then((code) => ({ code, captured }));
}

test("license-check: 11.a fresh cache (>6h left) -> exit 0, no refresh", async () => {
  const { dir, sessionFile } = setup();
  try {
    writeFileSync(sessionFile, "sess_abc");
    const claims = defaultClaims({ exp: Math.floor(Date.now() / 1000) + 12 * 3600 });
    writeCache({ token: mintJwt(claims), expires_at: claims.exp });
    let httpCalled = false;
    _setHttpsRequestForTesting(() => { httpCalled = true; throw new Error("should not be called"); });
    const { code } = await captureStderr(runCheck);
    assert.equal(code, 0);
    assert.equal(httpCalled, false);
  } finally { cleanup(dir); }
});

test("license-check: 11.b within refresh window -> calls /refresh, rewrites cache", async () => {
  const { dir, sessionFile } = setup();
  try {
    writeFileSync(sessionFile, "sess_abc");
    const oldClaims = defaultClaims({ exp: Math.floor(Date.now() / 1000) + 3 * 3600 });
    writeCache({ token: mintJwt(oldClaims), expires_at: oldClaims.exp });
    const newClaims = defaultClaims({ exp: Math.floor(Date.now() / 1000) + 24 * 3600 });
    const newToken = mintJwt(newClaims);
    _setHttpsRequestForTesting(fakeRequest({
      statusCode: 200,
      body: JSON.stringify({
        token: newToken,
        expires_at: newClaims.exp,
        user: { id: "usr_x", plan: "trial" },
        signed_ui_base_url: "https://static/skills/x/?sig=abc",
        render_token: "render.eyJ.x",
      }),
    }));
    const { code } = await captureStderr(runCheck);
    assert.equal(code, 0);
    const cached = readCache();
    assert.equal(cached.token, newToken);
    assert.equal(cached.user_id, "usr_x");
    assert.equal(cached.signed_ui_base_url, "https://static/skills/x/?sig=abc");
    assert.equal(cached.render_token, "render.eyJ.x");
    assert.equal(cached.grace_until, undefined); // P2.AMEND.3 — never written
  } finally { cleanup(dir); }
});

test("license-check: 11.c expired token, online refresh succeeds -> exit 0", async () => {
  const { dir, sessionFile } = setup();
  try {
    writeFileSync(sessionFile, "sess_abc");
    const expired = defaultClaims({ exp: Math.floor(Date.now() / 1000) - 3600 });
    writeCache({ token: mintJwt(expired), expires_at: expired.exp });
    const fresh = defaultClaims({ exp: Math.floor(Date.now() / 1000) + 24 * 3600 });
    _setHttpsRequestForTesting(fakeRequest({
      statusCode: 200,
      body: JSON.stringify({ token: mintJwt(fresh), expires_at: fresh.exp }),
    }));
    const { code } = await captureStderr(runCheck);
    assert.equal(code, 0);
  } finally { cleanup(dir); }
});

test("license-check: 11.d expired token offline -> exit 2 (zero-grace P2.AMEND.3)", async () => {
  const { dir, sessionFile } = setup();
  try {
    writeFileSync(sessionFile, "sess_abc");
    const expired = defaultClaims({ exp: Math.floor(Date.now() / 1000) - 3600 });
    // Even with a far-future grace_until, expired token must block.
    writeCache({
      token: mintJwt(expired),
      expires_at: expired.exp,
      grace_until: Math.floor(Date.now() / 1000) + 86400 * 7, // legacy field — must be ignored
    });
    _setHttpsRequestForTesting(fakeRequestNetworkError());
    const { code, captured } = await captureStderr(runCheck);
    assert.equal(code, 2);
    assert.match(captured, /Cannot reach AgntUX|expired|no cached/i);
  } finally { cleanup(dir); }
});

test("license-check: 11.f no cache, network down -> exit 2", async () => {
  const { dir, sessionFile } = setup();
  try {
    writeFileSync(sessionFile, "sess_abc");
    _setHttpsRequestForTesting(fakeRequestNetworkError());
    const { code, captured } = await captureStderr(runCheck);
    assert.equal(code, 2);
    assert.match(captured, /Cannot reach AgntUX/);
  } finally { cleanup(dir); }
});

test("license-check: 11.g trial expired (402) -> exit 2 with upgrade URL", async () => {
  const { dir, sessionFile } = setup();
  try {
    writeFileSync(sessionFile, "sess_abc");
    _setHttpsRequestForTesting(fakeRequest({
      statusCode: 402,
      body: JSON.stringify({ error: "trial_expired", upgrade_url: "https://x/upg" }),
    }));
    const { code, captured } = await captureStderr(runCheck);
    assert.equal(code, 2);
    assert.match(captured, /trial has ended/i);
    assert.match(captured, /https:\/\/x\/upg/);
  } finally { cleanup(dir); }
});

test("license-check: 11.h subscription_lapsed -> exit 2 with billing URL", async () => {
  const { dir, sessionFile } = setup();
  try {
    writeFileSync(sessionFile, "sess_abc");
    _setHttpsRequestForTesting(fakeRequest({
      statusCode: 402,
      body: JSON.stringify({ error: "subscription_lapsed", upgrade_url: "https://x/billing" }),
    }));
    const { code, captured } = await captureStderr(runCheck);
    assert.equal(code, 2);
    assert.match(captured, /billing failed/i);
  } finally { cleanup(dir); }
});

test("license-check: 11.i no session -> exit 2", async () => {
  const { dir } = setup();
  try {
    // no session file written
    const { code, captured } = await captureStderr(runCheck);
    assert.equal(code, 2);
    assert.match(captured, /No AgntUX session/);
  } finally { cleanup(dir); }
});

test("license-check: 11.j invalid_session (401) -> exit 2 re-auth", async () => {
  const { dir, sessionFile } = setup();
  try {
    writeFileSync(sessionFile, "sess_abc");
    _setHttpsRequestForTesting(fakeRequest({
      statusCode: 401,
      body: JSON.stringify({ error: "invalid_session" }),
    }));
    const { code, captured } = await captureStderr(runCheck);
    assert.equal(code, 2);
    assert.match(captured, /Re-authenticate/i);
  } finally { cleanup(dir); }
});

test("license-check: 11.n corrupt cache + good network -> heals cache, exit 0", async () => {
  const { dir, sessionFile, cacheFile } = setup();
  try {
    writeFileSync(sessionFile, "sess_abc");
    writeFileSync(cacheFile, "{not json");
    const fresh = defaultClaims({ exp: Math.floor(Date.now() / 1000) + 24 * 3600 });
    _setHttpsRequestForTesting(fakeRequest({
      statusCode: 200,
      body: JSON.stringify({ token: mintJwt(fresh), expires_at: fresh.exp }),
    }));
    const { code } = await captureStderr(runCheck);
    assert.equal(code, 0);
    const cached = readCache();
    assert.equal(cached.token, mintJwt(fresh));
  } finally { cleanup(dir); }
});

test("license-check: 503 with valid pre-exp cached token -> exit 0 (server transient)", async () => {
  const { dir, sessionFile } = setup();
  try {
    writeFileSync(sessionFile, "sess_abc");
    const claims = defaultClaims({ exp: Math.floor(Date.now() / 1000) + 4 * 3600 });
    writeCache({ token: mintJwt(claims), expires_at: claims.exp });
    _setHttpsRequestForTesting(fakeRequest({ statusCode: 503, body: "" }));
    const { code } = await captureStderr(runCheck);
    // Cached token still pre-exp (4h left, refresh window is 6h so it tries
    // to refresh, fails, but valid cache means accept).
    assert.equal(code, 0);
  } finally { cleanup(dir); }
});

test("license-check: device_limit_exceeded -> exit 2", async () => {
  const { dir, sessionFile } = setup();
  try {
    writeFileSync(sessionFile, "sess_abc");
    _setHttpsRequestForTesting(fakeRequest({
      statusCode: 403,
      body: JSON.stringify({ error: "device_limit_exceeded" }),
    }));
    const { code, captured } = await captureStderr(runCheck);
    assert.equal(code, 2);
    assert.match(captured, /Device limit/);
  } finally { cleanup(dir); }
});

test("license-check: cache write never includes grace_until (P2.AMEND.3)", async () => {
  const { dir, sessionFile, cacheFile } = setup();
  try {
    writeFileSync(sessionFile, "sess_abc");
    const fresh = defaultClaims({ exp: Math.floor(Date.now() / 1000) + 24 * 3600 });
    _setHttpsRequestForTesting(fakeRequest({
      statusCode: 200,
      body: JSON.stringify({
        token: mintJwt(fresh),
        expires_at: fresh.exp,
        grace_until: Math.floor(Date.now() / 1000) + 86400 * 7, // server sent it (legacy)
      }),
    }));
    const { code } = await captureStderr(runCheck);
    assert.equal(code, 0);
    const onDisk = JSON.parse(readFileSync(cacheFile, "utf8"));
    assert.equal(onDisk.grace_until, undefined);
  } finally { cleanup(dir); }
});
