export declare const scrubString: (s: string) => string;
export declare const scrub: (v: unknown, seen?: WeakSet<object>, depth?: number) => unknown;
type SentryLevel = "fatal" | "error" | "warning" | "info" | "debug";
export interface SentryClient {
    enabled: boolean;
    captureException(err: unknown, extra?: Record<string, unknown>): Promise<string | null>;
    captureMessage(message: string, extra?: Record<string, unknown>, level?: SentryLevel): Promise<string | null>;
}
export interface CreateSentryOptions {
    release?: string;
    environment?: string;
    tags?: Record<string, unknown>;
}
export declare function createSentry({ release, environment, tags }?: CreateSentryOptions): SentryClient;
export {};
