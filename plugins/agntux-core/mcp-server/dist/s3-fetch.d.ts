export declare const CACHE_TTL_MS: number;
export declare const CACHE_MAX = 100;
interface CacheEntry {
    html: string;
    ts: number;
}
export declare const memCache: Map<string, CacheEntry>;
export declare function lruGet(key: string): string | undefined;
export declare function lruSet(key: string, html: string): void;
export declare function fetchUIBundle(path: string): Promise<string>;
export declare function readRenderTokenFromLicense(): {
    token: string;
    kid: string;
} | undefined;
export {};
//# sourceMappingURL=s3-fetch.d.ts.map