import { type LicenseCache } from "./cache.js";
import { type ErrorKind, type StructuredError } from "./errors.js";
export type { LicenseCache, StructuredError, ErrorKind, };
export interface LicenseGateOptions {
    pluginName: string;
    pluginVersion: string;
    apiBase?: string;
    deviceName?: string;
}
export interface RequireOptions {
    reason: "tools/call";
    toolName?: string;
}
export interface LicenseGate {
    requireValidLicense(opts: RequireOptions): Promise<void | StructuredError>;
    isDevMode(): boolean;
}
export declare function createLicenseGate(opts: LicenseGateOptions): LicenseGate;
