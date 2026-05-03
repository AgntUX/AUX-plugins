// Resolves the AgntUX project root: the nearest ancestor directory whose
// lowercased basename is "agntux", falling back to <home>/agntux. When neither
// is found, returns null and the caller decides what to do (hooks treat it as
// out-of-scope passthrough; the onboarding agent runs the discovery flow).
//
// This is the single source of truth for "where does AgntUX user data live".
// All runtime call sites (hooks + MCP servers) use it; nothing else should
// hard-code `homedir() + "agntux"` or any literal `~/agntux-code/` path.
//
// Cross-platform: relies on node:os and node:path so drive letters, UNC paths,
// and POSIX roots are handled uniformly. The case-insensitive match means a
// user on Linux can name the directory `Agntux` without breaking resolution.
//
// Test seam: _setAgntuxRootForTesting(path) overrides the resolved value so
// hook integration tests can run in a temp directory.

import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { statSync } from "node:fs";

export const AGNTUX_DIR_NAME = "agntux";

let RESOLVED_OVERRIDE = null;

export function _setAgntuxRootForTesting(path) {
  RESOLVED_OVERRIDE = path === null ? null : resolve(path);
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/**
 * Resolve the AgntUX project root.
 *
 * Algorithm:
 *   1. Walk up from `cwd`. The first ancestor whose lowercased basename is
 *      "agntux" wins. node:path.dirname handles drive roots (C:\\), UNC
 *      paths (\\\\server\\share), and POSIX roots correctly.
 *   2. Fallback: <home>/agntux. join() emits the platform-correct separator.
 *   3. Not found → null.
 *
 * @param {string} [cwd] starting directory; defaults to process.cwd().
 *   process.cwd() itself can throw (`ENOENT: uv_cwd`) when the working
 *   directory was deleted underneath the process; we catch that and fall
 *   straight through to the home-dir fallback.
 * @returns {string|null} absolute path or null
 */
export function resolveAgntuxRoot(cwd) {
  if (RESOLVED_OVERRIDE !== null) return RESOLVED_OVERRIDE;

  let dir;
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

function fallback() {
  const f = join(homedir(), AGNTUX_DIR_NAME);
  if (isDir(f)) return f;
  return null;
}
