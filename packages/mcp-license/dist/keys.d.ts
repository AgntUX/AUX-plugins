export interface ActiveKey {
    kid: string;
    spki: string;
}
export declare const ACTIVE_KEYS: ActiveKey[];
export declare function _setKeysForTesting(keys: ActiveKey[] | null): void;
export declare function activeKeys(): ActiveKey[];
