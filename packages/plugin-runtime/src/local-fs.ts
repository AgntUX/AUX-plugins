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
import {
  type ListWithMetaEntry,
  mergeScope,
  ViewToolFsError,
  type ViewToolContext,
  type ViewToolFs,
  type ViewToolScope,
} from "./context.js";
import { extractFrontmatterMetadata } from "./parse-action.js";

// Re-export agntux-root helpers — local-fs callers only.
export {
  AGNTUX_DIR_NAME,
  expectedAgntuxRoot,
  resolveAgntuxRoot,
} from "./agntux-root.js";

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

const DEFAULT_LOG: ViewToolContext["log"] = () => {};

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
export function createLocalFsContext(
  opts: CreateLocalFsContextOptions,
): ViewToolContext {
  const root = resolve(opts.root);
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? DEFAULT_LOG;

  function resolveSafe(p: string): string {
    // Strip leading slash so absolute-looking inputs are treated as
    // root-relative. Then resolve and verify containment.
    const cleaned = p.replace(/^[/\\]+/, "");
    const abs = resolve(root, cleaned);
    const rel = relative(root, abs);
    if (rel.startsWith("..") || rel.split(sep).includes("..")) {
      throw new ViewToolFsError(
        "forbidden",
        p,
        "path escapes agntux project root",
      );
    }
    return abs;
  }

  function mapIoError(err: unknown, path: string): ViewToolFsError {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return new ViewToolFsError("not-found", path);
    if (code === "EACCES" || code === "EPERM") {
      return new ViewToolFsError("forbidden", path);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return new ViewToolFsError("transient", path, msg);
  }

  const fs: ViewToolFs = {
    async readFile(path) {
      const abs = resolveSafe(path);
      try {
        return await fsp.readFile(abs);
      } catch (err) {
        throw mapIoError(err, path);
      }
    },

    async readMany(paths) {
      // Local-fs has no per-call cost beyond a sys-call per file — fan
      // out everything in parallel. The S3 backend caps concurrency
      // because every read costs an S3 GET; we don't on local.
      return await Promise.all(
        paths.map(async (p) => {
          try {
            const abs = resolveSafe(p);
            return await fsp.readFile(abs);
          } catch {
            // Per the contract, per-file failures resolve to null
            // rather than throwing. Callers iterate the result array
            // and skip null entries.
            return null;
          }
        }),
      );
    },

    async list(prefix) {
      const abs = resolveSafe(prefix);
      // The prefix is interpreted as a directory: list every regular-file
      // descendant and return paths relative to the agntux root.
      let entries: string[];
      try {
        entries = await walk(abs);
      } catch (err) {
        const ioErr = mapIoError(err, prefix);
        if (ioErr.code === "not-found") return [];
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
      } catch {
        return false;
      }
    },

    async listWithMeta(prefix): Promise<ListWithMetaEntry[]> {
      // Local-fs has no server-side metadata index — we synthesize one
      // by reading every file in the prefix and parsing the YAML
      // frontmatter. Cheap enough for the dev iteration loop's typical
      // file counts (≤100 actions); the S3 backend joins against a
      // pre-populated `blob_metadata` table instead.
      const paths = await fs.list(prefix);
      const bufs = await fs.readMany(paths);
      const out: ListWithMetaEntry[] = [];
      for (let i = 0; i < paths.length; i++) {
        const buf = bufs[i];
        const meta = buf
          ? extractFrontmatterMetadata(buf.toString("utf8"))
          : null;
        out.push({ path: paths[i]!, meta });
      }
      return out;
    },
  };

  const baseScope = Object.freeze({ ...opts.scope });
  return makeContext(fs, baseScope, now, log);
}

function makeContext(
  fs: ViewToolFs,
  scope: Readonly<ViewToolScope>,
  now: () => Date,
  log: ViewToolContext["log"],
): ViewToolContext {
  const ctx: ViewToolContext = {
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

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries;
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch (err) {
      // Treat a missing leaf as empty so `list(prefix)` of a non-existent
      // directory returns [] rather than throwing.
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      throw err;
    }
    for (const ent of entries) {
      const full = join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}
