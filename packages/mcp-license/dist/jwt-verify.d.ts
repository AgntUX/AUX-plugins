export interface JWTPayload {
    iss?: string;
    aud?: string;
    exp?: number;
    nbf?: number;
    user?: {
        id?: string;
        plan?: string;
    };
    trial_expires_at?: number;
    [key: string]: unknown;
}
export type VerifyResult = {
    ok: true;
    payload: JWTPayload;
} | {
    ok: false;
    reason: string;
    payload?: JWTPayload;
};
export declare function _resetKeyCacheForTesting(): void;
export declare function verifyLicense(jwt: string, opts?: {
    now?: number;
}): VerifyResult;
