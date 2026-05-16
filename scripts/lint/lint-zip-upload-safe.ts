/**
 * lint-zip-upload-safe.ts — pass 9: enforce constraints that Claude Desktop's
 * plugin-zip upload validator imposes on plugin trees.
 *
 * Why this exists: Claude Desktop's "Settings → Plugins → Add plugins →
 * Upload a file" surface rejects zips whose member paths contain certain
 * characters with the unhelpful error "Zip file contains path with invalid
 * characters". Plugin authors hit this at upload time — by then the build
 * has succeeded and the only fix is to rename files and re-zip. This lint
 * catches the same conditions at PR time so the source tree never carries
 * names that would fail upload.
 *
 * Checks (PR-time, source-tree):
 *
 *   E20 — Forbidden filename characters
 *         Any file or directory whose name contains `{ } : ? * < > | "` or
 *         a control character (0x00–0x1F). These are rejected by Claude
 *         Desktop's validator and most are also not legal on Windows.
 *         Scaffold templates that need a placeholder in the filename
 *         should use the `__placeholder__` convention instead — see
 *         plugins/agntux-build/canonical/ui-handlers/_template/README.md.
 *
 *   E21 — Reserved plugin-name prefix
 *         plugin.json `name` MUST NOT start with `claude-` or `anthropic-`.
 *         The marketplace upload validator reserves these prefixes for
 *         impersonation protection.
 *
 *   E22 — Non-ASCII filename characters
 *         Any file/directory name containing a byte outside 0x20–0x7E
 *         (printable ASCII). Cross-platform zip readers are not required
 *         to handle non-ASCII paths consistently. Warning, not error —
 *         currently observed to work but fragile.
 *
 * Notes:
 *   - Walks the plugin directory and excludes the same paths the packager
 *     excludes (node_modules/, __tests__/, .omc/, etc.) so we only flag
 *     names that will actually end up in the shipped zip.
 *   - Skips the .git/ tree if it somehow ends up inside a plugin dir.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type Severity = "error" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  plugin: string;
  file: string;
  line?: number;
  col?: number;
  message: string;
}

// Same set of "this won't be in the shipped zip" excludes the packager
// uses. Kept in sync with EXCLUDE_PATTERNS in scripts/package-plugins.mjs.
// We only care about names that WILL ship — node_modules/ and friends
// would just produce noise.
const SKIP_BASENAMES = new Set([
  "node_modules",
  "__tests__",
  "examples",
  "_overrides",
  ".omc",
  ".git",
]);

// Filename chars that fail Claude Desktop's upload validator. These are
// the union of (a) the chars we've empirically observed rejected — `{`,
// `}` — and (b) the Windows reserved set: `: ? * < > | "`. Control chars
// (0x00–0x1F) are also rejected.
const FORBIDDEN_CHARS = /[{}:?*<>|"\x00-\x1f]/;
const FORBIDDEN_CHARS_DESCRIPTION = `{ } : ? * < > | " or control chars`;

// Non-ASCII anywhere in a filename → warning. Cross-platform zip readers
// handle UTF-8 inconsistently; Claude Desktop's behavior here isn't
// documented. Flag for review but don't block.
const NON_ASCII = /[^\x20-\x7e]/;

const RESERVED_PREFIXES = ["claude-", "anthropic-"];

export function pass9ZipUploadSafe(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const rel = (p: string): string => path.relative(repoRoot, p);

  // ── E20 / E22 — walk every shipped path and inspect each segment ──────────
  walk(pluginDir, (entryPath, basename) => {
    // E20 hard fail
    if (FORBIDDEN_CHARS.test(basename)) {
      findings.push({
        code: "E20",
        severity: "error",
        plugin: pluginSlug,
        file: rel(entryPath),
        message:
          `path segment "${basename}" contains characters that fail ` +
          `Claude Desktop's plugin-zip upload validator (${FORBIDDEN_CHARS_DESCRIPTION}). ` +
          `Scaffold templates that need a placeholder in the filename ` +
          `should use the __placeholder__ convention (see ` +
          `plugins/agntux-build/canonical/ui-handlers/_template/README.md).`,
      });
    }
    // E22 soft warn
    if (NON_ASCII.test(basename)) {
      findings.push({
        code: "E22",
        severity: "warning",
        plugin: pluginSlug,
        file: rel(entryPath),
        message:
          `path segment "${basename}" contains non-ASCII characters. ` +
          `Cross-platform zip readers handle UTF-8 inconsistently; ` +
          `prefer ASCII-only filenames in the shipped tree.`,
      });
    }
  });

  // ── E21 — plugin.json name must not use a reserved prefix ────────────────
  const manifestPath = path.join(pluginDir, ".claude-plugin", "plugin.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const name = typeof manifest.name === "string" ? manifest.name : "";
      const offending = RESERVED_PREFIXES.find((p) =>
        name.toLowerCase().startsWith(p),
      );
      if (offending) {
        findings.push({
          code: "E21",
          severity: "error",
          plugin: pluginSlug,
          file: rel(manifestPath),
          message:
            `plugin.json "name" "${name}" starts with reserved prefix ` +
            `"${offending}" — the marketplace upload validator reserves ` +
            `the claude- and anthropic- prefixes for impersonation protection. ` +
            `Pick a different name.`,
        });
      }
    } catch {
      // pass2 (schema validation) already reports unreadable manifests.
    }
  }
}

function walk(
  root: string,
  onEntry: (entryPath: string, basename: string) => void,
): void {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (SKIP_BASENAMES.has(ent.name)) continue;
      const full = path.join(cur, ent.name);
      onEntry(full, ent.name);
      if (ent.isDirectory()) stack.push(full);
    }
  }
}
