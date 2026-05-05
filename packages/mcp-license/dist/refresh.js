// POST /api/license/refresh — exchanges a session token for a fresh
// short-lived license JWT.
let FETCH_OVERRIDE = null;
export function _setFetchForTesting(fn) {
    FETCH_OVERRIDE = fn;
}
function fx() {
    return FETCH_OVERRIDE ?? fetch;
}
export async function refreshLicense(args) {
    let res;
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
    }
    catch (e) {
        return { ok: false, reason: "network", message: e.message };
    }
    let body = {};
    try {
        body = (await res.json());
    }
    catch {
        if (res.status === 200)
            return { ok: false, reason: "bad_response" };
    }
    if (res.status === 200) {
        return { ok: true, status: res.status, body: body };
    }
    return {
        ok: false,
        status: res.status,
        reason: typeof body.error === "string" ? body.error : `http_${res.status}`,
        message: typeof body.message === "string" ? body.message : undefined,
        upgrade_url: typeof body.upgrade_url === "string" ? body.upgrade_url : undefined,
    };
}
