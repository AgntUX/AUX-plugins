// Cache for the AgntUX license record at `~/.agntux/.license`.
// File mode 0600, parent dir 0700. Atomic writes via temp-file + rename.

import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  statSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface LicenseCache {
  token: string;
  expires_at?: number;
  last_refresh_at?: number;
  user_id?: string;
  plan?: string;
  trial_expires_at?: number;
  [key: string]: unknown;
}

let OVERRIDE_DIR: string | null = null;
let OVERRIDE_FILE: string | null = null;

export function _setCachePathsForTesting(
  dir: string | null,
  file: string | null,
): void {
  OVERRIDE_DIR = dir;
  OVERRIDE_FILE = file;
}

function cacheDir(): string {
  return OVERRIDE_DIR ?? join(homedir(), ".agntux");
}

export function cachePath(): string {
  return OVERRIDE_FILE ?? join(cacheDir(), ".license");
}

function ensureDir(): void {
  const dir = cacheDir();
  try {
    const st = statSync(dir);
    if (st.isDirectory()) {
      const mode = st.mode & 0o777;
      if (mode !== 0o700) {
        try { chmodSync(dir, 0o700); } catch { /* best-effort */ }
      }
      return;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function readLicenseCache():
  | LicenseCache
  | { _corrupt: true; error: string }
  | null {
  let raw: string;
  try {
    raw = readFileSync(cachePath(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return { _corrupt: true, error: (e as Error).message };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { _corrupt: true, error: "not an object" };
    }
    if (typeof parsed.token !== "string") {
      return { _corrupt: true, error: "missing token" };
    }
    return parsed as LicenseCache;
  } catch (e) {
    return { _corrupt: true, error: (e as Error).message };
  }
}

export function writeLicenseCache(record: LicenseCache): void {
  if (record === null || typeof record !== "object") {
    throw new TypeError("writeLicenseCache: record must be an object");
  }
  ensureDir();
  const target = cachePath();
  const suffix = randomBytes(6).toString("hex");
  const tmp = `${target}.tmp.${process.pid}.${suffix}`;
  const json = JSON.stringify(record, null, 2);
  writeFileSync(tmp, json, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
    renameSync(tmp, target);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
  try { chmodSync(target, 0o600); } catch { /* best-effort */ }
}
