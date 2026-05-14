// Resolves the AgntUX project root for the local-fs ViewToolContext factory:
// the nearest ancestor of process.cwd() whose lowercased basename is "agntux",
// falling back to <home>/agntux. Mirrors the canonical hook resolver and the
// agntux-core MCP twin so runtime path resolution is uniform across hooks,
// MCP servers, and view-tool runtimes.
//
// **Trust-model invariant.** This module is re-exported ONLY from
// `./local-fs.ts` (via the package's `/local-fs` export). The package root
// barrel (`./index.ts`) does NOT export it. The S3 factory in `app/` cannot
// import it accidentally because (a) the import path is conspicuous and
// (b) ESLint or invariant-checker rules in downstream consumers can pin
// "no `resolveAgntuxRoot` in app/lib/mcp/runtime/" if needed. The whole
// reason the helper is gated to the local factory is that any S3-backed
// caller derives container_id from the path + DB, never from the filesystem.

import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { statSync } from "node:fs";

export const AGNTUX_DIR_NAME = "agntux";

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

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
export function resolveAgntuxRoot(cwd?: string): string | null {
  const override = process.env.AGNTUX_ROOT_OVERRIDE;
  if (override) return override;

  let dir: string;
  try {
    dir = resolve(cwd ?? process.cwd());
  } catch {
    return fallback();
  }

  while (true) {
    if (basename(dir).toLowerCase() === AGNTUX_DIR_NAME && isDir(dir)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return fallback();
}

/**
 * Path-only resolution: never null. Falls back to <home>/agntux as a string
 * path even if the directory doesn't exist. Use this for path-traversal
 * guards and other string-level operations that don't require disk presence.
 *
 * Honors `AGNTUX_ROOT_OVERRIDE` via `resolveAgntuxRoot()`.
 */
export function expectedAgntuxRoot(cwd?: string): string {
  return resolveAgntuxRoot(cwd) ?? join(homedir(), AGNTUX_DIR_NAME);
}

function fallback(): string | null {
  const f = join(homedir(), AGNTUX_DIR_NAME);
  if (isDir(f)) return f;
  return null;
}
