// HTTPS POST to /api/license/refresh. Pure node:https; no fetch, no axios.
// Reads the long-lived AgntUX session token from `~/.agntux/.session`.

import { request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_REFRESH_URL = "https://app.agntux.ai/api/license/refresh";
const DEFAULT_TIMEOUT_MS = 5000;

let SESSION_PATH_OVERRIDE = null;
let REFRESH_URL_OVERRIDE = null;
let HTTPS_REQUEST_OVERRIDE = null;

export function _setSessionPathForTesting(path) {
  SESSION_PATH_OVERRIDE = path;
}

export function _setRefreshUrlForTesting(url) {
  REFRESH_URL_OVERRIDE = url;
}

// Inject a fake `request` for unit tests. The fake should match the
// node:https.request signature (url, options, callback) and return an object
// with .on(event,fn), .write(body), .end(), .destroy().
export function _setHttpsRequestForTesting(fn) {
  HTTPS_REQUEST_OVERRIDE = fn;
}

function sessionPath() {
  return SESSION_PATH_OVERRIDE || join(homedir(), ".agntux", ".session");
}

function refreshUrl() {
  return REFRESH_URL_OVERRIDE || DEFAULT_REFRESH_URL;
}

function readSession() {
  try {
    const raw = readFileSync(sessionPath(), "utf8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export async function refresh(args) {
  const opts = args || {};
  const deviceId = opts.deviceId;
  const pluginVersions = opts.pluginVersions || {};
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  const session = readSession();
  if (!session) return { ok: false, reason: "no_session" };

  const body = JSON.stringify({
    device_id: deviceId,
    plugin_versions: pluginVersions,
    client_ts: Math.floor(Date.now() / 1000),
  });

  const reqFn = HTTPS_REQUEST_OVERRIDE || httpsRequest;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const req = reqFn(
      refreshUrl(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "Authorization": `Bearer ${session}`,
          "User-Agent": "agntux-license-hook/1",
        },
        timeout: timeoutMs,
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => { chunks += c; });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              settle({ ok: true, body: JSON.parse(chunks) });
            } catch {
              settle({ ok: false, reason: "bad_response" });
            }
          } else {
            let parsed = {};
            try { parsed = JSON.parse(chunks); } catch { /* ignore */ }
            settle({
              ok: false,
              reason: parsed.error || `http_${res.statusCode}`,
              message: parsed.message,
              upgrade_url: parsed.upgrade_url,
              status: res.statusCode,
            });
          }
        });
        res.on("error", (e) => settle({ ok: false, reason: "network", detail: e.code }));
      },
    );
    req.on("error", (e) => settle({ ok: false, reason: "network", detail: e.code }));
    req.on("timeout", () => {
      try { req.destroy(); } catch { /* ignore */ }
      settle({ ok: false, reason: "timeout" });
    });
    try {
      req.write(body);
      req.end();
    } catch (e) {
      settle({ ok: false, reason: "network", detail: e.code });
    }
  });
}
