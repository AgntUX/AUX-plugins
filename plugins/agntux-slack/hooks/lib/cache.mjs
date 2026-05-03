// Cache for the AgntUX licence record at `~/.agntux/.license`.
// File mode 0600, parent dir 0700. Atomic writes via temp-file + rename
// inside the same directory (so the rename is atomic on POSIX).
//
// Per P2.AMEND.3, `grace_until` is no longer written or read. We pass
// through the field on a write only if the caller supplies it, but the
// verifier ignores it. New writes from this module never include it.

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

function defaultCacheDir() {
  return join(homedir(), ".agntux");
}

function defaultCachePath() {
  return join(defaultCacheDir(), ".license");
}

// Test override: allow tests to redirect the cache to a tmp dir without
// touching the user's real home.
let OVERRIDE_DIR = null;
let OVERRIDE_FILE = null;

export function _setCachePathsForTesting(dir, file) {
  OVERRIDE_DIR = dir;
  OVERRIDE_FILE = file;
}

function cacheDir() {
  return OVERRIDE_DIR || defaultCacheDir();
}

export function cachePath() {
  return OVERRIDE_FILE || defaultCachePath();
}

function ensureDir() {
  const dir = cacheDir();
  try {
    const st = statSync(dir);
    if (st.isDirectory()) {
      // Tighten perms if they drifted looser than 0700.
      const mode = st.mode & 0o777;
      if (mode !== 0o700) {
        try { chmodSync(dir, 0o700); } catch { /* best-effort */ }
      }
      return;
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function readCache() {
  let raw;
  try {
    raw = readFileSync(cachePath(), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    return { _corrupt: true, error: e.message };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { _corrupt: true, error: "not an object" };
    }
    if (typeof parsed.token !== "string") {
      return { _corrupt: true, error: "missing token" };
    }
    return parsed;
  } catch (e) {
    return { _corrupt: true, error: e.message };
  }
}

export function writeCache(record) {
  if (record === null || typeof record !== "object") {
    throw new TypeError("writeCache: record must be an object");
  }
  ensureDir();
  const target = cachePath();
  // Atomic write: temp file in the same dir, then rename. Rename is atomic
  // on POSIX when source and dest are on the same filesystem (always true
  // here since both live under cacheDir()).
  const suffix = randomBytes(6).toString("hex");
  const tmp = `${target}.tmp.${process.pid}.${suffix}`;
  const json = JSON.stringify(record, null, 2);
  writeFileSync(tmp, json, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600); // defensive: enforce mode even if umask widened it
    renameSync(tmp, target);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
  // After the rename, re-chmod the destination in case the file pre-existed
  // with looser perms (rename inherits dest perms on some platforms).
  try { chmodSync(target, 0o600); } catch { /* best-effort */ }
}
