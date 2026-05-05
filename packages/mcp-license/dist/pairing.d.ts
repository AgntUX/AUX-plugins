export interface PairingState {
    nonce: string;
    verification_url: string;
    expires_at: number;
}
export declare function _setPairingPathForTesting(p: string | null): void;
export declare function _setFetchForTesting(fn: typeof fetch | null): void;
export declare function readPairing(): PairingState | null;
export declare function writePairing(state: PairingState): void;
export declare function clearPairing(): void;
export declare function generateNonce(): string;
export interface RequestPairingResult {
    ok: boolean;
    status?: number;
    verification_url?: string;
    expires_in?: number;
    error?: string;
}
export declare function requestPairing(args: {
    apiBase: string;
    deviceId: string;
    deviceName: string;
    nonce: string;
}): Promise<RequestPairingResult>;
export interface PollPairingResult {
    ok: boolean;
    status?: number;
    state?: "pending" | "approved" | "denied";
    session_token?: string;
    user_id?: string;
    error?: string;
}
export declare function pollPairing(args: {
    apiBase: string;
    nonce: string;
}): Promise<PollPairingResult>;
