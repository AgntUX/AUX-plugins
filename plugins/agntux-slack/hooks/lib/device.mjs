// Stable per-machine device ID at `~/.agntux/.device` (0600). Parent dir 0700.
// Format: `dev_<16 hex chars>` where the hex is the prefix of
// sha256(hostname + ":" + random_8_bytes_hex).
//
// Hostname alone collides across re-imaged machines; pure random isn't pinned
// to the machine. Hostname + persisted random nonce is "stable per filesystem
// instance, unique enough for our `max_devices=3` ceiling" (P2 §5.4).

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  chmodSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

const DEVICE_ID_RE = /^dev_[a-f0-9]{16,}$/;

function defaultDir() { return join(homedir(), ".agntux"); }
function defaultPath() { return join(defaultDir(), ".device"); }

let OVERRIDE_DIR = null;
let OVERRIDE_FILE = null;
let HOSTNAME_OVERRIDE = null;

export function _setDevicePathsForTesting(dir, file) {
  OVERRIDE_DIR = dir;
  OVERRIDE_FILE = file;
}

export function _setHostnameForTesting(name) {
  HOSTNAME_OVERRIDE = name;
}

function dir() { return OVERRIDE_DIR || defaultDir(); }
function devicePath() { return OVERRIDE_FILE || defaultPath(); }
function host() { return HOSTNAME_OVERRIDE !== null ? HOSTNAME_OVERRIDE : hostname(); }

function ensureDir() {
  const d = dir();
  try {
    const st = statSync(d);
    if (st.isDirectory()) {
      const mode = st.mode & 0o777;
      if (mode !== 0o700) {
        try { chmodSync(d, 0o700); } catch { /* best-effort */ }
      }
      return;
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  mkdirSync(d, { recursive: true, mode: 0o700 });
}

export function getOrCreateDeviceId() {
  try {
    const id = readFileSync(devicePath(), "utf8").trim();
    if (DEVICE_ID_RE.test(id)) return id;
  } catch (e) {
    if (e.code !== "ENOENT") {
      // Corrupt or unreadable; fall through and re-mint.
    }
  }
  const nonce = randomBytes(8).toString("hex");
  const id = "dev_" + createHash("sha256")
    .update(host() + ":" + nonce)
    .digest("hex")
    .slice(0, 16);
  ensureDir();
  writeFileSync(devicePath(), id, { mode: 0o600 });
  try { chmodSync(devicePath(), 0o600); } catch { /* best-effort */ }
  return id;
}
