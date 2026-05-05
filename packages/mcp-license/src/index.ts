// @agntux/mcp-license — public API.
//
// `createLicenseGate({ pluginName, pluginVersion, apiBase? })` returns a
// `gate` that each MCP server wraps both `tools/call` and `resources/read`
// with. The single method is `requireValidLicense({ reason, toolName? })`,
// which returns `void` on success or a structured MCP error envelope on
// any blocking state.

import { hostname } from "node:os";
import {
  type LicenseCache,
  readLicenseCache,
  writeLicenseCache,
} from "./cache.js";
import { getOrCreateDeviceId } from "./device.js";
import {
  type ErrorKind,
  type StructuredError,
  buildErrorEnvelope,
} from "./errors.js";
import { verifyLicense } from "./jwt-verify.js";
import {
  clearPairing,
  generateNonce,
  pollPairing,
  readPairing,
  requestPairing,
  writePairing,
} from "./pairing.js";
import { refreshLicense } from "./refresh.js";
import { clearSession, readSession, writeSession } from "./session.js";

export type {
  LicenseCache,
  StructuredError,
  ErrorKind,
};

export interface LicenseGateOptions {
  pluginName: string;
  pluginVersion: string;
  apiBase?: string;
  deviceName?: string;
}

export interface RequireOptions {
  reason: "tools/call" | "resources/read";
  toolName?: string;
}

export interface LicenseGate {
  requireValidLicense(opts: RequireOptions): Promise<void | StructuredError>;
  isDevMode(): boolean;
}

const DEFAULT_API_BASE = "https://app.agntux.ai";
const PRE_REFRESH_WINDOW_S = 6 * 60 * 60;

export function createLicenseGate(opts: LicenseGateOptions): LicenseGate {
  const apiBase = (opts.apiBase ?? process.env.AGNTUX_API_BASE ?? DEFAULT_API_BASE)
    .replace(/\/+$/, "");
  const pluginName = opts.pluginName;
  const pluginVersion = opts.pluginVersion;
  // Default device label combines hostname and platform so the user can tell
  // their devices apart on the approve-pairing page (e.g. "Johns-MBP (darwin)").
  // Falls back to `${pluginName} on ${platform}` if hostname is unavailable.
  const deviceName = opts.deviceName ?? defaultDeviceName(pluginName);

  function isDevMode(): boolean {
    return process.env.AGNTUX_DEV_MODE === "1";
  }

  async function ensureSessionAndLicense(
    now: number,
  ): Promise<void | StructuredError> {
    const deviceId = getOrCreateDeviceId();

    // 1. If we have a pending pairing, poll it first — the user may have
    //    clicked the approval link since the previous tool call.
    const pendingPairing = readPairing();
    if (pendingPairing) {
      if (pendingPairing.expires_at <= now) {
        clearPairing();
        // Fall through to issue a fresh pairing.
      } else {
        const poll = await pollPairing({
          apiBase,
          nonce: pendingPairing.nonce,
        });
        if (!poll.ok) {
          if (poll.status === 410) {
            // Expired or already consumed server-side — clear and re-pair.
            clearPairing();
          } else {
            return buildErrorEnvelope("pairing_pending", {
              pluginName,
              apiBase,
              verificationUrl: pendingPairing.verification_url,
            });
          }
        } else if (poll.state === "approved" && poll.session_token) {
          writeSession(poll.session_token);
          clearPairing();
          // Fall through to refresh the license below.
        } else if (poll.state === "denied") {
          clearPairing();
          return buildErrorEnvelope("pairing_required", {
            pluginName,
            apiBase,
          });
        } else {
          // Still pending.
          return buildErrorEnvelope("pairing_pending", {
            pluginName,
            apiBase,
            verificationUrl: pendingPairing.verification_url,
          });
        }
      }
    }

    // 2. Need a session token to refresh the license.
    const session = readSession();
    if (!session) {
      const nonce = generateNonce();
      const req = await requestPairing({
        apiBase,
        deviceId,
        deviceName,
        nonce,
      });
      if (!req.ok || !req.verification_url) {
        return buildErrorEnvelope("pairing_failed", {
          pluginName,
          apiBase,
          detail: req.error,
        });
      }
      const expiresAt = now + (req.expires_in ?? 900);
      writePairing({
        nonce,
        verification_url: req.verification_url,
        expires_at: expiresAt,
      });
      return buildErrorEnvelope("pairing_required", {
        pluginName,
        apiBase,
        verificationUrl: req.verification_url,
      });
    }

    // 3. Have a session token. Refresh the license.
    const refresh = await refreshLicense({
      apiBase,
      sessionToken: session,
      deviceId,
      pluginVersions: { [pluginName]: pluginVersion },
    });
    if (!refresh.ok) {
      return mapRefreshErrorToEnvelope(refresh.reason, refresh.upgrade_url);
    }
    if (!refresh.body || typeof refresh.body.token !== "string") {
      return buildErrorEnvelope("network_unavailable", {
        pluginName,
        apiBase,
        detail: "bad refresh response",
      });
    }

    writeLicenseCache({
      ...refresh.body,
      last_refresh_at: now,
    });
    return undefined;
  }

  function mapRefreshErrorToEnvelope(
    reason: string | undefined,
    upgradeUrl: string | undefined,
  ): StructuredError {
    switch (reason) {
      case "trial_expired":
        return buildErrorEnvelope("trial_expired", {
          pluginName,
          apiBase,
          upgradeUrl,
        });
      case "subscription_lapsed":
        return buildErrorEnvelope("subscription_lapsed", {
          pluginName,
          apiBase,
          upgradeUrl,
        });
      case "subscription_canceled":
        return buildErrorEnvelope("subscription_canceled", {
          pluginName,
          apiBase,
          upgradeUrl,
        });
      case "device_limit_exceeded":
        return buildErrorEnvelope("device_limit_exceeded", {
          pluginName,
          apiBase,
          upgradeUrl,
        });
      case "invalid_session":
        // Session is no longer valid — drop it so the next call starts a
        // fresh pairing rather than looping on a dead session.
        clearSession();
        return buildErrorEnvelope("invalid_session", { pluginName, apiBase });
      case "network":
      case "timeout":
      case "bad_response":
        return buildErrorEnvelope("network_unavailable", {
          pluginName,
          apiBase,
          detail: reason,
        });
      default:
        return buildErrorEnvelope("network_unavailable", {
          pluginName,
          apiBase,
          detail: reason ?? "unknown",
        });
    }
  }

  async function requireValidLicense(
    _opts: RequireOptions,
  ): Promise<void | StructuredError> {
    if (isDevMode()) return undefined;

    const now = Math.floor(Date.now() / 1000);

    const cached = readLicenseCache();
    if (cached && !("_corrupt" in cached)) {
      const v = verifyLicense(cached.token, { now });
      if (v.ok) {
        const remaining = (v.payload.exp ?? 0) - now;
        if (remaining > PRE_REFRESH_WINDOW_S) {
          return undefined;
        }
        // In window — try a silent refresh, but don't block on failure since
        // the cached token is still valid.
        const session = readSession();
        if (session) {
          const refresh = await refreshLicense({
            apiBase,
            sessionToken: session,
            deviceId: getOrCreateDeviceId(),
            pluginVersions: { [pluginName]: pluginVersion },
          });
          if (refresh.ok && refresh.body) {
            writeLicenseCache({
              ...refresh.body,
              last_refresh_at: now,
            });
          }
        }
        return undefined;
      }
      // Cached token is invalid (expired or otherwise). Fall through to
      // refresh / pair.
    }

    return ensureSessionAndLicense(now);
  }

  return { requireValidLicense, isDevMode };
}

function defaultDeviceName(pluginName: string): string {
  let host = "";
  try {
    host = hostname();
  } catch {
    // hostname() can throw on locked-down environments; fall through.
  }
  if (host) return `${host} (${process.platform})`;
  return `${pluginName} on ${process.platform}`;
}
