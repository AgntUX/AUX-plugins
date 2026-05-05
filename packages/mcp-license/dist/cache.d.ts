export interface LicenseCache {
    token: string;
    expires_at?: number;
    last_refresh_at?: number;
    user_id?: string;
    plan?: string;
    trial_expires_at?: number;
    [key: string]: unknown;
}
export declare function _setCachePathsForTesting(dir: string | null, file: string | null): void;
export declare function cachePath(): string;
export declare function readLicenseCache(): LicenseCache | {
    _corrupt: true;
    error: string;
} | null;
export declare function writeLicenseCache(record: LicenseCache): void;
