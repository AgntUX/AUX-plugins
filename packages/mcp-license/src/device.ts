// Stable per-machine device ID at `~/.agntux/.device` (0600).
// Format: `dev_<16 hex chars>`.

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

let OVERRIDE_PATH: string | null = null;
let HOSTNAME_OVERRIDE: string | null = null;

export function _setDevicePathForTesting(p: string | null): void {
  OVERRIDE_PATH = p;
}

export function _setHostnameForTesting(name: string | null): void {
  HOSTNAME_OVERRIDE = name;
}

function devicePath(): string {
  return OVERRIDE_PATH ?? join(homedir(), ".agntux", ".device");
}

function host(): string {
  return HOSTNAME_OVERRIDE ?? hostname();
}

function ensureDir(): void {
  const dir = join(devicePath(), "..");
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

export function getOrCreateDeviceId(): string {
  try {
    const id = readFileSync(devicePath(), "utf8").trim();
    if (DEVICE_ID_RE.test(id)) return id;
  } catch {
    // fall through and re-mint
  }
  const nonce = randomBytes(8).toString("hex");
  const id =
    "dev_" +
    createHash("sha256").update(host() + ":" + nonce).digest("hex").slice(0, 16);
  ensureDir();
  writeFileSync(devicePath(), id, { mode: 0o600 });
  try { chmodSync(devicePath(), 0o600); } catch { /* best-effort */ }
  return id;
}
