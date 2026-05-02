// Resolves the AgntUX project root for the orchestrator MCP server: the
// nearest ancestor of process.cwd() whose lowercased basename is "agntux",
// falling back to <home>/agntux. Mirrors the canonical hook resolver so
// runtime path resolution is uniform across hooks and MCP servers.
//
// Two entry points:
//   - resolveAgntuxRoot(): returns the absolute path or null when no root
//     can be located. Use when null is meaningful (e.g., signalling
//     "no project; passthrough").
//   - expectedAgntuxRoot(): never null. Falls back to <home>/agntux as a
//     string path even if the directory does not exist. Use for
//     path-traversal guards and other string-only operations; FS calls
//     against the returned path will fail naturally if it does not exist.

import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { statSync } from "node:fs";

const AGNTUX_DIR_NAME = "agntux";

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/**
 * Resolve the AgntUX project root.
 *
 *   1. Walk up from cwd; first ancestor whose lowercased basename is "agntux"
 *      AND is a directory wins.
 *   2. Fallback: <home>/agntux when it exists on disk.
 *   3. Otherwise null — caller decides what to do.
 */
export function resolveAgntuxRoot(cwd?: string): string | null {
  let dir: string;
  try { dir = resolve(cwd ?? process.cwd()); } catch { return fallback(); }

  while (true) {
    if (basename(dir).toLowerCase() === AGNTUX_DIR_NAME && isDir(dir)) return dir;
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
 * Subsequent FS calls will fail naturally if the directory is missing.
 */
export function expectedAgntuxRoot(cwd?: string): string {
  return resolveAgntuxRoot(cwd) ?? join(homedir(), AGNTUX_DIR_NAME);
}

function fallback(): string | null {
  const f = join(homedir(), AGNTUX_DIR_NAME);
  if (isDir(f)) return f;
  return null;
}
