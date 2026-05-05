export interface StructuredError {
    isError: true;
    content: Array<{
        type: "text";
        text: string;
    }>;
}
export type ErrorKind = "pairing_required" | "pairing_pending" | "pairing_failed" | "trial_expired" | "subscription_lapsed" | "subscription_canceled" | "device_limit_exceeded" | "invalid_session" | "network_unavailable";
export interface ErrorContext {
    pluginName: string;
    apiBase: string;
    verificationUrl?: string;
    upgradeUrl?: string;
    detail?: string;
}
export declare function buildErrorEnvelope(kind: ErrorKind, ctx: ErrorContext): StructuredError;
