// =============================================================================
// FROZEN CONTRACT — Sub-plan 4 owns this surface.
//
// `ViewToolContext` is the cross-environment shim that lets a view-tool handler
// run BOTH on agntux-core's local MCP server (reading from a local agntux
// project root) AND on the remote `/api/mcp` route in app/ (reading from
// S3-backed `team_files` / `team_file_blobs`). Sub-plans 2, 3, and 5 all bind
// to the shapes declared in this file. Removing or renaming an existing field
// is a coordinated breaking change across four PRs. Adding a NEW optional
// field is backwards-compatible.
//
// The factory that produces a ViewToolContext lives in a per-environment
// module:
//   - `src/local-fs.ts`  → createLocalFsContext({ root, scope })
//   - `app/lib/mcp/runtime/index.ts` → createS3FsContext({ userId, organizationId })
//
// Trust-model invariant: handlers receive a ViewToolContext and nothing else.
// They cannot import `node:fs`, `fetch`, `process.env`, `child_process`.
// The compiled view-tool bundle external-izes `@agntux/plugin-runtime`, so the
// surface area is exactly: `ctx.fs`, `ctx.scope`, `ctx.now()`, `ctx.log()`,
// `ctx.withScope()`, plus the pure helpers re-exported from this package
// (parse-action, manifest-schema). See `src/index.ts` for the public barrel.
// =============================================================================
const STATUS_BY_CODE = {
    "not-found": 404,
    forbidden: 403,
    transient: 503,
    schema: 500,
};
/**
 * Uniform error shape across both fs factories. Sub-plan 2's `/api/mcp` route
 * maps this to a JSON-RPC error envelope on the way out:
 *   - `404` → `-32004` (resource not found)
 *   - `403` → `-32001` (forbidden)
 *   - `503` → `-32002` (transient — caller should retry)
 *   - `500` → `-32603` (internal error)
 *
 * Mirrors `BlobUploadError` / `ContainerLookupError` in `app/lib/sync/` so
 * app developers see one consistent error model.
 */
export class ViewToolFsError extends Error {
    code;
    path;
    status;
    constructor(code, path, message) {
        super(message ?? `${code}: ${path}`);
        this.name = "ViewToolFsError";
        this.code = code;
        this.path = path;
        this.status = STATUS_BY_CODE[code];
    }
}
/**
 * Helper used by both factories to enforce the immutability contract:
 * given a `scope` object plus an `extra` partial, return a fresh frozen
 * scope merging the two. The factory's `withScope` callers reuse this
 * to avoid drifting on the merge semantics.
 */
export function mergeScope(scope, extra) {
    return Object.freeze({
        ...scope,
        ...extra,
    });
}
