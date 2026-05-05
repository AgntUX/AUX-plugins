/**
 * Resolve the AgntUX project root.
 *
 *   0. AGNTUX_ROOT_OVERRIDE env var, if set — escape hatch for tests
 *      (vitest workers can't `process.chdir`, so injecting cwd is impossible)
 *      and for hosts that pin the root externally. Production never sets it.
 *   1. Walk up from cwd; first ancestor whose lowercased basename is "agntux"
 *      AND is a directory wins.
 *   2. Fallback: <home>/agntux when it exists on disk.
 *   3. Otherwise null — caller decides what to do.
 */
export declare function resolveAgntuxRoot(cwd?: string): string | null;
/**
 * Path-only resolution: never null. Falls back to <home>/agntux as a string
 * path even if the directory doesn't exist. Use this for path-traversal
 * guards and other string-level operations that don't require disk presence.
 * Subsequent FS calls will fail naturally if the directory is missing.
 *
 * Honors `AGNTUX_ROOT_OVERRIDE` via `resolveAgntuxRoot()`.
 */
export declare function expectedAgntuxRoot(cwd?: string): string;
//# sourceMappingURL=agntux-root.d.ts.map