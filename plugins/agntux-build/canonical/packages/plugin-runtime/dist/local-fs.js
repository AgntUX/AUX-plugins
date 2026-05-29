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
import { createHash, randomBytes } from "node:crypto";
import { promises as fsp } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { mergeScope, ViewToolFsError, } from "./context.js";
import { extractFrontmatterMetadata } from "./parse-action.js";
const LOCAL_CONTAINER_ID = "local-fs";
const MAX_UPDATE_RETRIES = 3;
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
        async readMany(paths) {
            // Local-fs has no per-call cost beyond a sys-call per file — fan
            // out everything in parallel. The S3 backend caps concurrency
            // because every read costs an S3 GET; we don't on local.
            return await Promise.all(paths.map(async (p) => {
                try {
                    const abs = resolveSafe(p);
                    return await fsp.readFile(abs);
                }
                catch {
                    // Per the contract, per-file failures resolve to null
                    // rather than throwing. Callers iterate the result array
                    // and skip null entries.
                    return null;
                }
            }));
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
        async listWithMeta(prefix) {
            // Local-fs has no server-side metadata index — we synthesize one
            // by reading every file in the prefix and parsing the YAML
            // frontmatter. Cheap enough for the dev iteration loop's typical
            // file counts (≤100 actions); the S3 backend joins against a
            // pre-populated `blob_metadata` table instead.
            const paths = await fs.list(prefix);
            const bufs = await fs.readMany(paths);
            const out = [];
            for (let i = 0; i < paths.length; i++) {
                const buf = bufs[i];
                const meta = buf
                    ? extractFrontmatterMetadata(buf.toString("utf8"))
                    : null;
                out.push({ path: paths[i], meta });
            }
            return out;
        },
        async writeFile(path, body, opts) {
            const abs = resolveSafe(path);
            const bodyBuf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
            // Best-effort CAS: read the current sha and compare against the
            // caller's parent_sha. For local-fs we don't have a true atomic
            // CAS — between the read here and the rename below another writer
            // could land — but the typical "user opens triage in one window"
            // case is cheaply guarded by the comparison.
            if (opts && Object.hasOwn(opts, "parent_sha")) {
                const expected = opts.parent_sha;
                const current = await currentShaOrNull(abs);
                if (current !== expected) {
                    throw new ViewToolFsError("conflict", path, `parent_sha mismatch (expected ${expected ?? "null"}, found ${current ?? "null"})`);
                }
            }
            try {
                await fsp.mkdir(dirname(abs), { recursive: true });
            }
            catch (err) {
                throw mapIoError(err, path);
            }
            // Atomic write: write to a sibling `.tmp` then rename. Mirrors the
            // pattern used by the legacy local mcp-server's tools.
            const tmp = abs + ".tmp." + randomBytes(4).toString("hex");
            try {
                await fsp.writeFile(tmp, bodyBuf, { mode: 0o644 });
                await fsp.rename(tmp, abs);
            }
            catch (err) {
                // Best-effort cleanup of the tmp on rename failure.
                try {
                    await fsp.unlink(tmp);
                }
                catch {
                    /* ignore */
                }
                throw mapIoError(err, path);
            }
            const new_sha256 = createHash("sha256").update(bodyBuf).digest("hex");
            // For local-fs we have no monotonic seq — use the file's mtime
            // milliseconds as a coarse stand-in. Good enough for the dev
            // iteration loop; production runs on S3 where `seq` is real.
            let seq = 0;
            try {
                const st = await fsp.stat(abs);
                seq = Math.floor(st.mtimeMs);
            }
            catch {
                /* fall through */
            }
            return {
                new_sha256,
                seq,
                container_id: LOCAL_CONTAINER_ID,
            };
        },
        async update(path, patch) {
            for (let attempt = 0; attempt < MAX_UPDATE_RETRIES; attempt++) {
                let current;
                let parentSha;
                try {
                    const buf = await fs.readFile(path);
                    current = buf.toString("utf8");
                    parentSha = createHash("sha256").update(buf).digest("hex");
                }
                catch (err) {
                    if (err instanceof ViewToolFsError &&
                        err.code === "not-found") {
                        current = null;
                        parentSha = null;
                    }
                    else {
                        throw err;
                    }
                }
                const next = await patch(current);
                try {
                    return await fs.writeFile(path, next, { parent_sha: parentSha });
                }
                catch (err) {
                    if (err instanceof ViewToolFsError &&
                        err.code === "conflict" &&
                        attempt < MAX_UPDATE_RETRIES - 1) {
                        // Jittered backoff: 5–25 ms. Local-fs CAS conflicts are rare
                        // (mostly developer iteration with file watchers in play) so
                        // a tight loop is fine.
                        const delay = 5 + Math.floor(Math.random() * 20);
                        await new Promise((r) => setTimeout(r, delay));
                        continue;
                    }
                    throw err;
                }
            }
            // Shouldn't reach — the loop either returns or re-throws.
            throw new ViewToolFsError("conflict", path, "update() exceeded retry budget");
        },
        async deleteFile(path, opts) {
            const abs = resolveSafe(path);
            if (opts && Object.hasOwn(opts, "parent_sha")) {
                const expected = opts.parent_sha;
                const current = await currentShaOrNull(abs);
                if (current !== expected) {
                    throw new ViewToolFsError("conflict", path, `parent_sha mismatch (expected ${expected ?? "null"}, found ${current ?? "null"})`);
                }
            }
            try {
                await fsp.unlink(abs);
            }
            catch (err) {
                const code = err?.code;
                // Tombstone idempotency: deleting an already-gone file is a no-op
                // success, matching the S3 backend's contract.
                if (code !== "ENOENT") {
                    throw mapIoError(err, path);
                }
            }
            return {
                new_sha256: "0".repeat(64),
                seq: Date.now(),
                container_id: LOCAL_CONTAINER_ID,
            };
        },
    };
    async function currentShaOrNull(abs) {
        try {
            const buf = await fsp.readFile(abs);
            return createHash("sha256").update(buf).digest("hex");
        }
        catch (err) {
            const code = err?.code;
            if (code === "ENOENT")
                return null;
            throw err;
        }
    }
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
