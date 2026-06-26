// Zero-dependency Sentry client for AgntUX plugin stdio MCP servers. POSTs
// scrubbed error events to the `agntux-plugins` Sentry project. The scrubbing
// denylist mirrors the app's lib/observability/scrub.ts — keep them in sync.
import https from "node:https";
import { randomUUID } from "node:crypto";

const DEFAULT_DSN =
  "https://f1e209fbd00492b9601def0921c789c1@o4511633648975872.ingest.us.sentry.io/4511633995792384";

const DENY = ["authorization","cookie","token","secret","password","passwd","jwt","apikey","privatekey","refresh","idtoken","session","credential","bearer","signingkey"];
const isSensitiveKey = (k) => {
  const n = String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
  return DENY.some((d) => n.includes(d));
};
const JWT_RE = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
const BEARER_RE = /\b(bearer|basic)\s+[a-z0-9._~+/-]+=*/gi;
const URL_RE = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s:@]+@/gi;
const SNTRY_RE = /\bsntr[a-z]{1,4}_[a-zA-Z0-9+/_=-]{8,}/g;

export const scrubString = (s) =>
  String(s)
    .replace(URL_RE, "$1[redacted]@")
    .replace(BEARER_RE, "$1 [redacted]")
    .replace(JWT_RE, "[redacted-jwt]")
    .replace(SNTRY_RE, "[redacted-token]");

export const scrub = (v, seen = new WeakSet(), depth = 0) => {
  if (v == null || depth > 6) return v;
  if (typeof v === "string") return scrubString(v);
  if (typeof v !== "object") return v;
  if (seen.has(v)) return undefined;
  seen.add(v);
  if (Array.isArray(v)) return v.map((x) => scrub(x, seen, depth + 1));
  const o = {};
  for (const [k, val] of Object.entries(v)) {
    o[k] = isSensitiveKey(k) ? "[redacted]" : scrub(val, seen, depth + 1);
  }
  return o;
};

const parseDsn = (dsn) => {
  const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn || "");
  return m ? { key: m[1], host: m[2], projectId: m[3] } : null;
};

export function createSentry({ release, environment, tags } = {}) {
  const disabled = !!process.env.AGNTUX_DISABLE_TELEMETRY;
  const parsed = disabled
    ? null
    : parseDsn(process.env.SENTRY_DSN_PLUGINS || DEFAULT_DSN);
  const env = environment || process.env.NODE_ENV || "production";

  const send = (event) =>
    new Promise((resolve) => {
      if (!parsed) return resolve(null);
      try {
        const body = JSON.stringify(event);
        const req = https.request(
          {
            method: "POST",
            host: parsed.host,
            path: `/api/${parsed.projectId}/store/`,
            timeout: 4000,
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
              "x-sentry-auth": `Sentry sentry_version=7, sentry_client=agntux-plugin/1.0, sentry_key=${parsed.key}`,
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(event.event_id));
          }
        );
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
          req.destroy();
          resolve(null);
        });
        req.write(body);
        req.end();
      } catch {
        resolve(null);
      }
    });

  const baseEvent = (level) => ({
    event_id: randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "node",
    level,
    environment: env,
    release,
    // NOTE: no server_name — these run on CUSTOMER machines; hostname is PII.
    tags: scrub(tags || {}),
  });

  return {
    enabled: !!parsed,
    captureException(err, extra) {
      if (!parsed) return Promise.resolve(null);
      const e = err instanceof Error ? err : new Error(String(err));
      const ev = baseEvent("error");
      ev.exception = {
        values: [{ type: e.name || "Error", value: scrubString(e.message || "") }],
      };
      ev.extra = scrub({ ...(extra || {}), stack: e.stack ? scrubString(e.stack) : undefined });
      return send(ev);
    },
    captureMessage(message, extra, level = "info") {
      if (!parsed) return Promise.resolve(null);
      const ev = baseEvent(level);
      ev.message = { formatted: scrubString(message) };
      if (extra) ev.extra = scrub(extra);
      return send(ev);
    },
  };
}
