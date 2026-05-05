import type { LicenseCache } from "./cache.js";
export declare function _setFetchForTesting(fn: typeof fetch | null): void;
export interface RefreshResult {
    ok: boolean;
    status?: number;
    body?: LicenseCache;
    reason?: string;
    message?: string;
    upgrade_url?: string;
}
export declare function refreshLicense(args: {
    apiBase: string;
    sessionToken: string;
    deviceId: string;
    pluginVersions: Record<string, string>;
}): Promise<RefreshResult>;
