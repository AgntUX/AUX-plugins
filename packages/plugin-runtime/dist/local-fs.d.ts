import { type ViewToolContext, type ViewToolScope } from "./context.js";
export { AGNTUX_DIR_NAME, expectedAgntuxRoot, resolveAgntuxRoot, } from "./agntux-root.js";
/** Bundle of derived paths the local factory operates on. */
export interface AgntuxRootPaths {
    root: string;
    dataSchemaDir: string;
    dataDir: string;
}
export interface CreateLocalFsContextOptions {
    /** Absolute path to the agntux project root. Required. */
    root: string;
    /** Per-call scope. `user_id` and `organization_id` are required. */
    scope: ViewToolScope;
    /** Override `Date.now()` for deterministic tests. */
    now?: () => Date;
    /** Override the structured log emitter. Defaults to a no-op. */
    log?: ViewToolContext["log"];
}
/**
 * Build a `ViewToolContext` backed by `node:fs/promises`.
 *
 * Error mapping:
 *   - `ENOENT`           → `ViewToolFsError("not-found", path)`
 *   - `EACCES`/`EPERM`   → `ViewToolFsError("forbidden", path)`
 *   - any other I/O      → `ViewToolFsError("transient", path)`
 *
 * The path-traversal check converts `..` escapes into `forbidden`. Schema /
 * parse failures bubble up from caller-side helpers (e.g. `parseActionFile`)
 * — this factory itself never throws a `"schema"` code.
 */
export declare function createLocalFsContext(opts: CreateLocalFsContextOptions): ViewToolContext;
