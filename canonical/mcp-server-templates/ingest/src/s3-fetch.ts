import { request } from "node:https";
import { mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// {{plugin-slug}} is the per-source plugin's slug (e.g., "slack-ingest").
// The generator substitutes this at build time from the manifest name field.
// CACHE_DIR is keyed per plugin slug so multiple ingest plugins' caches don't collide.
const PLUGIN_SLUG = process.env.PLUGIN_SLUG ?? "{{plugin-slug}}";

const LICENSE_PATH = join(homedir(), ".agntux", ".license");
const APP_ID_FALLBACK = process.env.AGNTUX_APP_ID;
const S3_BASE_FALLBACK = process.env.AGNTUX_S3_BASE ?? "https://static.agntux.ai/skills";
const CACHE_DIR = join(homedir(), ".agntux", ".ui-cache", PLUGIN_SLUG);

// LRU cache: max 100 entries, 5-minute TTL (in-memory layer on top of on-disk cache).
// Params are identical to the orchestrator template (P5 §7.4 / P4 §6.7).
export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const CACHE_MAX = 100;

interface CacheEntry {
  html: string;
  ts: number; // Date.now() when cached
}

// In-memory LRU: ordered map (insertion = LRU order; move-to-end on access).
// Exported for unit testing only — treat as package-internal.
export const memCache = new Map<string, CacheEntry>();

export function lruGet(key: string): string | undefined {
  const entry = memCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    memCache.delete(key);
    return undefined;
  }
  // Move to end (most recently used).
  memCache.delete(key);
  memCache.set(key, entry);
  return entry.html;
}

export function lruSet(key: string, html: string): void {
  // Evict oldest entry when at capacity.
  if (memCache.size >= CACHE_MAX) {
    const oldest = memCache.keys().next().value;
    if (oldest !== undefined) memCache.delete(oldest);
  }
  memCache.set(key, { html, ts: Date.now() });
}

mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });

// Read the signed URL prefix for this plugin from the licence cache.
// Prefers the per-plugin entry in `signed_ui_base_urls` (map keyed by plugin slug)
// over the flat `signed_ui_base_url` (orchestrator-only MVP shape).
// Falls back to env vars when the cache is uninitialised (development / out-of-band runs).
function resolveSignedBase(): string {
  try {
    const cached = JSON.parse(readFileSync(LICENSE_PATH, "utf8"));
    // Per-plugin entry takes precedence (P5 §6.3 / P5.AMEND.1).
    if (
      cached?.signed_ui_base_urls &&
      typeof cached.signed_ui_base_urls === "object" &&
      typeof cached.signed_ui_base_urls[PLUGIN_SLUG] === "string"
    ) {
      return cached.signed_ui_base_urls[PLUGIN_SLUG] as string;
    }
    // Fall back to flat orchestrator URL if per-plugin entry is absent.
    if (typeof cached?.signed_ui_base_url === "string") {
      return cached.signed_ui_base_url;
    }
  } catch { /* cache missing or corrupt — fall through */ }
  if (!APP_ID_FALLBACK) {
    throw new Error(
      `No signed_ui_base_urls["${PLUGIN_SLUG}"] or signed_ui_base_url in ~/.agntux/.license ` +
      "and no AGNTUX_APP_ID env fallback. " +
      "Run the SessionStart license-check hook to populate the cache, or set " +
      "AGNTUX_APP_ID + AGNTUX_S3_BASE for development."
    );
  }
  return `${S3_BASE_FALLBACK}/${APP_ID_FALLBACK}/`;
}

// Append the path to a base URL while preserving any query string (the
// signature). e.g. base "https://.../skills/X/?X-Amz-Signature=..." plus
// path "thread/index.html" becomes
// "https://.../skills/X/thread/index.html?X-Amz-Signature=...".
function appendPathPreservingQuery(base: string, path: string): string {
  const qIndex = base.indexOf("?");
  if (qIndex === -1) {
    return base.endsWith("/") ? base + path : base + "/" + path;
  }
  const prefix = base.slice(0, qIndex);
  const query = base.slice(qIndex);
  const joined = prefix.endsWith("/") ? prefix + path : prefix + "/" + path;
  return joined + query;
}

function diskCachePath(cacheKey: string): string {
  return join(CACHE_DIR, cacheKey);
}

export async function fetchUIBundle(path: string): Promise<string> {
  const cacheKey = path.replace(/[^a-zA-Z0-9]/g, "_");

  // 1. In-memory LRU check (fast path, bounded TTL + size).
  const mem = lruGet(cacheKey);
  if (mem !== undefined) return mem;

  // 2. On-disk cache check (survives process restarts).
  const diskPath = diskCachePath(cacheKey);
  try {
    const stat = statSync(diskPath);
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      const html = readFileSync(diskPath, "utf8");
      lruSet(cacheKey, html);
      return html;
    }
  } catch { /* cache miss; fall through */ }

  const url = appendPathPreservingQuery(resolveSignedBase(), path);

  const html = await new Promise<string>((resolve, reject) => {
    const req = request(url, { method: "GET", timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        // 403 here typically means the signed URL has expired. The hook's
        // bg refresh path should renew it before this happens; if it doesn't,
        // the user sees a UI fetch error and can restart the host to re-refresh.
        reject(new Error(`S3 fetch ${url} returned ${res.statusCode}`));
        return;
      }
      let chunks = "";
      res.on("data", (c: Buffer | string) => (chunks += c));
      res.on("end", () => resolve(chunks));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error(`S3 fetch ${url} timed out`)); });
    req.end();
  });

  // Write to disk cache atomically.
  const tmp = diskPath + ".tmp";
  try {
    writeFileSync(tmp, html, { mode: 0o600 });
    // rename is atomic on POSIX when src and dst are on the same filesystem.
    const { renameSync } = await import("node:fs");
    renameSync(tmp, diskPath);
  } catch {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }

  lruSet(cacheKey, html);
  return html;
}

export function readRenderTokenFromLicense(): { token: string; kid: string } | undefined {
  if (process.env.AGNTUX_DEV_MODE === "1") return undefined;
  try {
    const cached = JSON.parse(readFileSync(LICENSE_PATH, "utf8"));
    if (typeof cached?.render_token === "string") {
      return { token: cached.render_token, kid: "agntux-render-v1" };
    }
  } catch { /* cache missing or corrupt */ }
  return undefined;
}
