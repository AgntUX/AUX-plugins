// Session token I/O at `~/.agntux/.session` (mode 0600).

import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  statSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let OVERRIDE_PATH: string | null = null;

export function _setSessionPathForTesting(p: string | null): void {
  OVERRIDE_PATH = p;
}

export function sessionPath(): string {
  return OVERRIDE_PATH ?? join(homedir(), ".agntux", ".session");
}

function ensureDir(): void {
  const dir = join(sessionPath(), "..");
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

export function readSession(): string | null {
  try {
    const raw = readFileSync(sessionPath(), "utf8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function writeSession(token: string): void {
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("writeSession: token must be a non-empty string");
  }
  ensureDir();
  writeFileSync(sessionPath(), token, { mode: 0o600 });
  try { chmodSync(sessionPath(), 0o600); } catch { /* best-effort */ }
}

export function clearSession(): void {
  try { unlinkSync(sessionPath()); } catch { /* ignore */ }
}
