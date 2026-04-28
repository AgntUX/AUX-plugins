import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import {
  refresh,
  _setSessionPathForTesting,
  _setRefreshUrlForTesting,
  _setHttpsRequestForTesting,
} from "../lib/refresh.mjs";

function setupSession(value) {
  const dir = mkdtempSync(join(tmpdir(), "agntux-refresh-test-"));
  const file = join(dir, ".session");
  if (value !== null) writeFileSync(file, value);
  _setSessionPathForTesting(file);
  return { dir, file };
}

function cleanupSession(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  _setSessionPathForTesting(null);
  _setRefreshUrlForTesting(null);
  _setHttpsRequestForTesting(null);
}

// Build a fake `https.request` stand-in. The fake immediately calls back
// with a synthetic response.
function fakeRequest({ statusCode, body }) {
  return (url, options, cb) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      // call the callback with the response
      cb(res);
      // emit the data and end events
      setImmediate(() => {
        if (body) res.emit("data", body);
        res.emit("end");
      });
    };
    req.destroy = () => {};
    return req;
  };
}

function fakeRequestError(code) {
  return (url, options, cb) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      setImmediate(() => req.emit("error", Object.assign(new Error("fail"), { code })));
    };
    req.destroy = () => {};
    return req;
  };
}

function fakeRequestTimeout() {
  return (url, options, cb) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      setImmediate(() => req.emit("timeout"));
    };
    req.destroy = () => {};
    return req;
  };
}

test("refresh: no session -> no_session", async () => {
  const { dir } = setupSession(null); // no file written
  try {
    const r = await refresh({ deviceId: "dev_x", pluginVersions: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_session");
  } finally { cleanupSession(dir); }
});

test("refresh: empty session file -> no_session", async () => {
  const { dir } = setupSession("");
  try {
    const r = await refresh({ deviceId: "dev_x", pluginVersions: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_session");
  } finally { cleanupSession(dir); }
});

test("refresh: 200 OK with JSON body -> ok:true", async () => {
  const { dir } = setupSession("sess_abc");
  _setHttpsRequestForTesting(fakeRequest({
    statusCode: 200,
    body: JSON.stringify({ token: "eyJ.x.y", expires_at: 12345 }),
  }));
  try {
    const r = await refresh({ deviceId: "dev_x", pluginVersions: {} });
    assert.equal(r.ok, true);
    assert.equal(r.body.token, "eyJ.x.y");
    assert.equal(r.body.expires_at, 12345);
  } finally { cleanupSession(dir); }
});

test("refresh: 200 OK with bad JSON -> bad_response", async () => {
  const { dir } = setupSession("sess_abc");
  _setHttpsRequestForTesting(fakeRequest({ statusCode: 200, body: "{not json" }));
  try {
    const r = await refresh({ deviceId: "dev_x", pluginVersions: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_response");
  } finally { cleanupSession(dir); }
});

test("refresh: 402 trial_expired propagates error code + url", async () => {
  const { dir } = setupSession("sess_abc");
  _setHttpsRequestForTesting(fakeRequest({
    statusCode: 402,
    body: JSON.stringify({ error: "trial_expired", message: "trial done", upgrade_url: "https://x/upg" }),
  }));
  try {
    const r = await refresh({ deviceId: "dev_x", pluginVersions: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "trial_expired");
    assert.equal(r.upgrade_url, "https://x/upg");
    assert.equal(r.status, 402);
  } finally { cleanupSession(dir); }
});

test("refresh: 500 with no JSON -> http_500", async () => {
  const { dir } = setupSession("sess_abc");
  _setHttpsRequestForTesting(fakeRequest({ statusCode: 500, body: "internal" }));
  try {
    const r = await refresh({ deviceId: "dev_x", pluginVersions: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "http_500");
  } finally { cleanupSession(dir); }
});

test("refresh: network error -> network", async () => {
  const { dir } = setupSession("sess_abc");
  _setHttpsRequestForTesting(fakeRequestError("ECONNREFUSED"));
  try {
    const r = await refresh({ deviceId: "dev_x", pluginVersions: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "network");
    assert.equal(r.detail, "ECONNREFUSED");
  } finally { cleanupSession(dir); }
});

test("refresh: timeout -> timeout", async () => {
  const { dir } = setupSession("sess_abc");
  _setHttpsRequestForTesting(fakeRequestTimeout());
  try {
    const r = await refresh({ deviceId: "dev_x", pluginVersions: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "timeout");
  } finally { cleanupSession(dir); }
});
