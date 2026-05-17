/**
 * lint-view-tool-bundles.ts — pass 10: every file shipped under a plugin's
 * view-tool/dist/ui-resources/*.html MUST be a real, self-contained HTML
 * document, not a raw JS module renamed to .html.
 *
 * Why this exists: Vite + vite-plugin-singlefile only inlines the bundle
 * INTO an HTML document when the rollup `input` is an HTML file. Pointing
 * input directly at a `.tsx` source while overriding
 * `output.entryFileNames` to `"[name].html"` produces a JavaScript file
 * with an `.html` extension — the MCP App view-tool then registers it
 * as `mimeType: "text/html"`, the host iframe loads the resource, and
 * Claude Cowork (and any compliant MCP App host) rejects it with
 * "Unsupported UI resource content format" because the body starts with
 * `var Bi={exports:{}}` instead of `<!doctype html>`.
 *
 * This regression already shipped once (agntux-core triage, agntux-gmail
 * compose, agntux-slack compose+canvas) before it was caught by a user.
 * Pass 10 makes the bug structurally impossible to ship again.
 *
 * Check (E23):
 *   For each plugin with `view-tool/dist/ui-resources/`, every `.html`
 *   file at the top level of that directory MUST start (after optional
 *   UTF-8 BOM and leading whitespace) with one of:
 *     <!doctype …>
 *     <html …>
 *     <head …> / <body …> / <meta …>
 *
 *   If the body instead starts with JS tokens (`var `, `const `, `let `,
 *   `function`, `(function`, `import `, `export `), the lint fails with
 *   the runbook to add an HTML entry to vite.config.ts.
 *
 * Scope:
 *   - Only `view-tool/dist/ui-resources/*.html` (the shipped iframe
 *     bundles registered as `ui://…` resources).
 *   - NOT files under `ui-handlers/<name>/component/out/` (those are
 *     component dev scaffolds, not shipped UI resources) — though
 *     those happen to be real HTML today.
 *   - NOT non-`.html` siblings (e.g. .js, .map).
 *
 * Detection budget:
 *   - Read only the first 1024 bytes per file. We only need to look at
 *     the first non-whitespace token.
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

// Read the first N bytes of a file without slurping the full bundle.
// Single-file UI bundles can be hundreds of KB; we only need the head.
const HEAD_BYTES = 1024;

function readHead(filePath: string): string {
  const buf = Buffer.alloc(HEAD_BYTES);
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// Strip UTF-8 BOM, leading whitespace, and any leading HTML or JS
// comment header before classifying. Real-world bundles often carry
// a leading banner:
//   - Vite/Rollup may emit `<!-- ... -->\n<!doctype html>` (legitimate HTML)
//   - Terser/UglifyJS emit `/*! react-dom@18 */var x=1` (legitimate JS)
// Without comment-stripping the classifier would either:
//   (a) false-positive on legit HTML with a comment header
//   (b) false-negative on JS bundles whose comment banner pushes the
//       `var`/`(function` past the regex anchor
function stripPrefix(head: string): string {
  let s = head;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  // Iterate: whitespace → comment → whitespace → ... until neither matches.
  for (;;) {
    const before = s.length;
    s = s.replace(/^\s+/, "");
    // HTML comment: `<!-- ... -->` (non-greedy, can span lines)
    s = s.replace(/^<!--[\s\S]*?-->/, "");
    // JS block comment: `/* ... */`
    s = s.replace(/^\/\*[\s\S]*?\*\//, "");
    // JS line comment: `// ...\n`
    s = s.replace(/^\/\/[^\n]*\n?/, "");
    if (s.length === before) break;
  }
  return s;
}

const HTML_OPENERS = /^<(?:!doctype|html|head|body|meta|link|title|style|script)\b/i;

// Tokens that unambiguously identify a JS bundle written by Rollup
// when the entry was a .ts/.tsx and entryFileNames renamed it to
// .html. Matched after stripPrefix. Case-sensitive: JS keywords are
// lowercase; matching `VAR x=1` would be an identifier, not a leak.
const JS_OPENERS = [
  /^var\s/,
  /^const\s/,
  /^let\s/,
  /^function\s*[(\w]/,
  /^\(function\b/,
  /^;\s*\(function\b/, // semicolon-prefixed IIFE (terser/uglify minified)
  /^!function\b/,
  /^import\s/,
  /^export\s/,
  /^["']use strict["']/, // 'use strict' OR "use strict"
];

function classify(body: string): "html" | "js" | "unknown" {
  if (HTML_OPENERS.test(body)) return "html";
  for (const r of JS_OPENERS) if (r.test(body)) return "js";
  return "unknown";
}

export function pass10ViewToolBundles(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const rel = (p: string): string => path.relative(repoRoot, p);
  const dir = path.join(pluginDir, "view-tool", "dist", "ui-resources");
  if (!fs.existsSync(dir)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith(".html")) continue;
    const full = path.join(dir, ent.name);

    let head: string;
    try {
      head = readHead(full);
    } catch {
      continue;
    }
    if (head.length === 0) {
      findings.push({
        code: "E23",
        severity: "error",
        plugin: pluginSlug,
        file: rel(full),
        message:
          `${ent.name} is empty. A view-tool UI resource must be a ` +
          `self-contained HTML document; rebuild the plugin via ` +
          `node scripts/build-plugin.mjs ${pluginSlug}.`,
      });
      continue;
    }

    const verdict = classify(stripPrefix(head));
    if (verdict === "html") continue;

    const snippet = head.slice(0, 80).replace(/\s+/g, " ").trim();
    findings.push({
      code: "E23",
      severity: "error",
      plugin: pluginSlug,
      file: rel(full),
      message:
        `${ent.name} is not a self-contained HTML document — the file ` +
        `starts with ${verdict === "js" ? "a JavaScript bundle" : "non-HTML content"} ` +
        `("${snippet}…") but ships with mimeType "text/html". ` +
        `Compliant MCP App hosts (Claude Cowork, MCPJam) reject this with ` +
        `"Unsupported UI resource content format".\n` +
        `Fix: point Vite's rollupOptions.input at a real HTML file (not the ` +
        `.tsx source). Add a sibling ${ent.name} next to vite.config.ts that ` +
        `imports the .tsx via <script type="module"> and remove any ` +
        `output.entryFileNames override. See plugins/agntux-core/view-tool/ ` +
        `for the canonical shape.`,
    });
  }
}
