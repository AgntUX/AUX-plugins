// Mock T06 backend for the local-mock integration test mode.
//
// Spins up a tiny `node:http` server on an ephemeral port and answers
// `/api/license/refresh` with whatever response the test caller programs in.
// Programmable via `setNextResponse({ status, body })` — each call to /refresh
// pops the next response off a queue. If the queue is empty the server
// returns 503.
//
// Why http (not https)? The hook's `lib/refresh.mjs` uses node:https; the
// integration test stubs `_setHttpsRequestForTesting` with a thin wrapper
// that drives requests against this http mock. No TLS cert dance needed.
//
// The server also tracks every refresh call (timestamp + body) for
// assertions like "scenario c spawned exactly one refresh in the cooldown
// window".

import { createServer } from "node:http";

export function startMockServer() {
  const responseQueue = [];
  const calls = [];
  let server = null;
  let port = 0;

  function setNextResponse(resp) {
    responseQueue.push(resp);
  }

  function setDefaultResponse(resp) {
    // Always served when queue is empty (used for "every call returns 503")
    responseQueue.length = 0;
    responseQueue._default = resp;
  }

  function getCalls() {
    return calls.slice();
  }

  function reset() {
    responseQueue.length = 0;
    delete responseQueue._default;
    calls.length = 0;
  }

  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        let parsed = null;
        try { parsed = body.length > 0 ? JSON.parse(body) : null; } catch { /* ignore */ }
        calls.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: parsed,
          rawBody: body,
          ts: Date.now(),
        });
        const next = responseQueue.shift() || responseQueue._default || { status: 503, body: "" };
        res.statusCode = next.status;
        res.setHeader("content-type", "application/json");
        const out = typeof next.body === "string" ? next.body : JSON.stringify(next.body || {});
        res.end(out);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        setNextResponse,
        setDefaultResponse,
        getCalls,
        reset,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// Build an `https.request`-compatible stub that drives the mock server. The
// hook's `lib/refresh.mjs` calls `httpsRequest(url, options, callback)`; we
// rewrite the URL to point at our local http server and use `node:http`.
import { request as httpRequest } from "node:http";
import { URL } from "node:url";

export function makeHttpsStub(mockUrl) {
  return (url, options, cb) => {
    // Replace the original host/port with the mock's. Preserve path.
    const orig = typeof url === "string" ? new URL(url) : url;
    const target = new URL(mockUrl);
    const rewritten = {
      hostname: target.hostname,
      port: target.port,
      path: orig.pathname + (orig.search || ""),
      method: options.method,
      headers: options.headers,
      timeout: options.timeout,
    };
    return httpRequest(rewritten, cb);
  };
}
