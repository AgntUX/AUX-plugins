// Pairing-state I/O at `~/.agntux/.pairing` plus magic-link API helpers.
//
// The pairing file tracks a pending nonce between MCP calls so that when the
// user clicks the email link (off-process), the next tools/call can poll
// the magic-link/poll endpoint with the same nonce and pick up the session
// token without re-requesting a fresh pairing.

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
import { randomBytes } from "node:crypto";

export interface PairingState {
  nonce: string;
  verification_url: string;
  expires_at: number;
}

let OVERRIDE_PATH: string | null = null;
let FETCH_OVERRIDE: typeof fetch | null = null;

export function _setPairingPathForTesting(p: string | null): void {
  OVERRIDE_PATH = p;
}

export function _setFetchForTesting(fn: typeof fetch | null): void {
  FETCH_OVERRIDE = fn;
}

function pairingPath(): string {
  return OVERRIDE_PATH ?? join(homedir(), ".agntux", ".pairing");
}

function fx(): typeof fetch {
  return FETCH_OVERRIDE ?? fetch;
}

function ensureDir(): void {
  const dir = join(pairingPath(), "..");
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

export function readPairing(): PairingState | null {
  let raw: string;
  try {
    raw = readFileSync(pairingPath(), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.nonce === "string" &&
      typeof parsed.verification_url === "string" &&
      typeof parsed.expires_at === "number"
    ) {
      return parsed as PairingState;
    }
    return null;
  } catch {
    return null;
  }
}

export function writePairing(state: PairingState): void {
  ensureDir();
  writeFileSync(pairingPath(), JSON.stringify(state, null, 2), { mode: 0o600 });
  try { chmodSync(pairingPath(), 0o600); } catch { /* best-effort */ }
}

export function clearPairing(): void {
  try { unlinkSync(pairingPath()); } catch { /* ignore */ }
}

export function generateNonce(): string {
  return randomBytes(32).toString("base64url");
}

export interface RequestPairingResult {
  ok: boolean;
  status?: number;
  verification_url?: string;
  expires_in?: number;
  error?: string;
}

export async function requestPairing(args: {
  apiBase: string;
  deviceId: string;
  deviceName: string;
  nonce: string;
}): Promise<RequestPairingResult> {
  try {
    const res = await fx()(`${args.apiBase}/api/auth/magic-link/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: args.deviceId,
        device_name: args.deviceName,
        nonce: args.nonce,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      verification_url?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, status: res.status, error: body.error };
    }
    return {
      ok: true,
      status: res.status,
      verification_url: body.verification_url,
      expires_in: body.expires_in,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface PollPairingResult {
  ok: boolean;
  status?: number;
  state?: "pending" | "approved" | "denied";
  session_token?: string;
  user_id?: string;
  error?: string;
}

export async function pollPairing(args: {
  apiBase: string;
  nonce: string;
}): Promise<PollPairingResult> {
  try {
    const res = await fx()(`${args.apiBase}/api/auth/magic-link/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce: args.nonce }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
      session_token?: string;
      user_id?: string;
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, status: res.status, error: body.error };
    }
    if (body.status === "pending" || body.status === "approved" || body.status === "denied") {
      return {
        ok: true,
        status: res.status,
        state: body.status,
        session_token: body.session_token,
        user_id: body.user_id,
      };
    }
    return { ok: false, status: res.status, error: "bad_response" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
