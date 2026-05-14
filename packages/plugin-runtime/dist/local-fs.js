// =============================================================================
// Local-fs ViewToolContext factory.
//
// Used by agntux-core's local MCP server (the desktop-side plugin host). Reads
// directly from a resolved agntux project root via `node:fs/promises`. The
// `path` arguments handed to `ctx.fs.readFile` etc. are interpreted as paths
// RELATIVE to the agntux root.
//
// Path-traversal guard: every path is resolved against the root and the
// resolved absolute path must remain a descendant. `..` segments that escape
// the root throw `forbidden`.
//
// Re-exports `resolveAgntuxRoot` and `expectedAgntuxRoot` so callers in this
// environment can resolve the root with the same logic the rest of the
// agntux toolchain uses. These are deliberately NOT re-exported from the
// package root barrel — see the trust-model note in `src/index.ts`.
// =============================================================================
import { promises as fsp } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { mergeScope, ViewToolFsError, } from "./context.js";
// Re-export agntux-root helpers — local-fs callers only.
export { AGNTUX_DIR_NAME, expectedAgntuxRoot, resolveAgntuxRoot, } from "./agntux-root.js";
const DEFAULT_LOG = () => { };
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
export function createLocalFsContext(opts) {
    const root = resolve(opts.root);
    const now = opts.now ?? (() => new Date());
    const log = opts.log ?? DEFAULT_LOG;
    function resolveSafe(p) {
        // Strip leading slash so absolute-looking inputs are treated as
        // root-relative. Then resolve and verify containment.
        const cleaned = p.replace(/^[/\\]+/, "");
        const abs = resolve(root, cleaned);
        const rel = relative(root, abs);
        if (rel.startsWith("..") || rel.split(sep).includes("..")) {
            throw new ViewToolFsError("forbidden", p, "path escapes agntux project root");
        }
        return abs;
    }
    function mapIoError(err, path) {
        const code = err?.code;
        if (code === "ENOENT")
            return new ViewToolFsError("not-found", path);
        if (code === "EACCES" || code === "EPERM") {
            return new ViewToolFsError("forbidden", path);
        }
        const msg = err instanceof Error ? err.message : String(err);
        return new ViewToolFsError("transient", path, msg);
    }
    const fs = {
        async readFile(path) {
            const abs = resolveSafe(path);
            try {
                return await fsp.readFile(abs);
            }
            catch (err) {
                throw mapIoError(err, path);
            }
        },
        async list(prefix) {
            const abs = resolveSafe(prefix);
            // The prefix is interpreted as a directory: list every regular-file
            // descendant and return paths relative to the agntux root.
            let entries;
            try {
                entries = await walk(abs);
            }
            catch (err) {
                const ioErr = mapIoError(err, prefix);
                if (ioErr.code === "not-found")
                    return [];
                throw ioErr;
            }
            const rel = entries
                .map((p) => relative(root, p))
                .map((p) => (sep === "/" ? p : p.split(sep).join("/")))
                .sort();
            // Mirror the S3 factory's hard cap so plugin authors see the same
            // ceiling in both environments.
            return rel.slice(0, 1000);
        },
        async exists(path) {
            try {
                const abs = resolveSafe(path);
                await fsp.stat(abs);
                return true;
            }
            catch {
                return false;
            }
        },
    };
    const baseScope = Object.freeze({ ...opts.scope });
    return makeContext(fs, baseScope, now, log);
}
function makeContext(fs, scope, now, log) {
    const ctx = {
        fs,
        scope,
        now,
        log,
        withScope(extra) {
            return makeContext(fs, mergeScope(scope, extra), now, log);
        },
    };
    return ctx;
}
async function walk(dir) {
    const out = [];
    const stack = [dir];
    while (stack.length > 0) {
        const cur = stack.pop();
        let entries;
        try {
            entries = await fsp.readdir(cur, { withFileTypes: true });
        }
        catch (err) {
            // Treat a missing leaf as empty so `list(prefix)` of a non-existent
            // directory returns [] rather than throwing.
            const code = err?.code;
            if (code === "ENOENT" || code === "ENOTDIR")
                continue;
            throw err;
        }
        for (const ent of entries) {
            const full = join(cur, ent.name);
            if (ent.isDirectory()) {
                stack.push(full);
            }
            else if (ent.isFile()) {
                out.push(full);
            }
        }
    }
    return out;
}
