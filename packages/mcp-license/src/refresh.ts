// POST /api/license/refresh — exchanges a session token for a fresh
// short-lived license JWT.

import type { LicenseCache } from "./cache.js";

let FETCH_OVERRIDE: typeof fetch | null = null;

export function _setFetchForTesting(fn: typeof fetch | null): void {
  FETCH_OVERRIDE = fn;
}

function fx(): typeof fetch {
  return FETCH_OVERRIDE ?? fetch;
}

export interface RefreshResult {
  ok: boolean;
  status?: number;
  body?: LicenseCache;
  reason?: string;
  message?: string;
  upgrade_url?: string;
}

export async function refreshLicense(args: {
  apiBase: string;
  sessionToken: string;
  deviceId: string;
  pluginVersions: Record<string, string>;
}): Promise<RefreshResult> {
  let res: Response;
  try {
    res = await fx()(`${args.apiBase}/api/license/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.sessionToken}`,
        "User-Agent": "agntux-mcp-license/1",
      },
      body: JSON.stringify({
        device_id: args.deviceId,
        plugin_versions: args.pluginVersions,
        client_ts: Math.floor(Date.now() / 1000),
      }),
    });
  } catch (e) {
    return { ok: false, reason: "network", message: (e as Error).message };
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    if (res.status === 200) return { ok: false, reason: "bad_response" };
  }

  if (res.status === 200) {
    return { ok: true, status: res.status, body: body as unknown as LicenseCache };
  }

  return {
    ok: false,
    status: res.status,
    reason: typeof body.error === "string" ? (body.error as string) : `http_${res.status}`,
    message: typeof body.message === "string" ? (body.message as string) : undefined,
    upgrade_url:
      typeof body.upgrade_url === "string" ? (body.upgrade_url as string) : undefined,
  };
}
