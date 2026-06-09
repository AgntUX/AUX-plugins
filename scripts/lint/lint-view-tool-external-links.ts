/**
 * lint-view-tool-external-links.ts — pass 16: view-tool components must never
 * navigate the host via raw anchors or `window.open`. External links MUST go
 * through the host bridge: `useAppsClient().openLink(url)` (or the shared
 * `ExternalLink` wrapper that calls it).
 *
 * Why this exists
 * ---------------
 * MCP App iframes are sandboxed. A plain `<a href target="_blank">` (or
 * `window.open(...)`) is silently swallowed by the sandbox — the click does
 * nothing, the user assumes the feature is broken. The host exposes a
 * first-class primitive for this: `openLink(url)` emits the `ui/open-link`
 * postMessage the host handles natively (opening the browser / native client).
 *
 * In production (agntux-google-calendar, 2026-06) the schedule + respond views
 * shipped four `<a href target="_blank">` links — "Open in Google Calendar",
 * "Join Google Meet", and prep "Sources" — every one a dead click. The
 * apps-client already exposed `openLink`; the components just weren't using it.
 * agntux-slack and agntux-gmail already do the right thing via a shared
 * `ExternalLink` component, so the rule was known — it just wasn't enforced.
 *
 * Pass 16 makes the rule structural: any `target="_blank"`, `window.open(`, or
 * `<a … href …>` in a view-tool component source is an error.
 *
 * Findings
 * --------
 *   E31 (error) — a view-tool component uses a sandboxed-blocked external-nav
 *     pattern (`target="_blank"`, `window.open(`, or `<a href>`). Replace with
 *     the `ExternalLink` component (or a `<button onClick={() =>
 *     useAppsClient().openLink(url)}>`).
 *
 * Scope
 * -----
 *   - Runs against any plugin with a `view-tool/src/` directory.
 *   - Recurses `view-tool/src/**` for `.ts` / `.tsx`, EXCLUDING `lib/`
 *     (vendored apps-client / apps-react), `__tests__/`, test utilities, and
 *     `*.d.ts`. The component tree (`components/`, `apps/<name>/components/`,
 *     top-level `*-ui.tsx`) is where authored JSX lives.
 *   - The shared `ExternalLink` component itself passes naturally: its only
 *     `<a href>` mentions are inside `//` comments, which are scrubbed.
 *   - The canonical `_template` under agntux-build is not a plugin slug, so it
 *     is never linted here.
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

const VIEW_TOOL_SRC_REL = "view-tool/src";

// Patterns that only make sense for in-iframe external navigation, every one
// of which the sandbox silently blocks.
const PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /\btarget\s*=\s*\{?\s*["']_blank["']/, what: 'target="_blank"' },
  { re: /\bwindow\.open\s*\(/, what: "window.open(" },
  // JSX anchor element carrying an href attribute (`href=` or `href ={`).
  { re: /<a\s[^>]*\bhref\b\s*=/, what: "<a href>" },
];

/**
 * Replace comments with spaces while PRESERVING string-literal contents and
 * newlines. We must preserve strings because the signal we match (`"_blank"`)
 * IS a string literal; we must preserve newlines so reported line numbers are
 * exact. Naive on `\`-escapes inside strings only — sufficient for source we
 * also typecheck and build.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const len = src.length;
  let inStr: string | null = null;
  while (i < len) {
    const c = src[i];
    const next = src[i + 1];
    if (inStr) {
      if (c === "\\") {
        out += c + (next ?? "");
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < len && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < len && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function isExcluded(relFromSrc: string): boolean {
  const parts = relFromSrc.split(path.sep);
  if (parts.includes("lib")) return true;
  if (parts.includes("__tests__")) return true;
  if (parts.some((p) => p === "test-utils")) return true;
  const base = parts[parts.length - 1];
  if (base.endsWith(".d.ts")) return true;
  if (base === "setup.ts") return true;
  return false;
}

function collectSources(dir: string, srcRoot: string, acc: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      collectSources(abs, srcRoot, acc);
      continue;
    }
    if (!e.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    const relFromSrc = path.relative(srcRoot, abs);
    if (isExcluded(relFromSrc)) continue;
    acc.push(abs);
  }
}

export function pass16ViewToolExternalLinks(
  pluginSlug: string,
  pluginDir: string,
  _repoRoot: string,
  findings: Finding[],
): void {
  const srcDir = path.join(pluginDir, VIEW_TOOL_SRC_REL);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) return;

  const files: string[] = [];
  collectSources(srcDir, srcDir, files);
  files.sort();

  for (const abs of files) {
    let body: string;
    try {
      body = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const scrubbed = stripComments(body);
    const lines = scrubbed.split("\n");
    const relFile = path.join(VIEW_TOOL_SRC_REL, path.relative(srcDir, abs));
    for (let li = 0; li < lines.length; li++) {
      for (const { re, what } of PATTERNS) {
        const m = re.exec(lines[li]);
        if (m) {
          findings.push({
            code: "E31",
            severity: "error",
            plugin: pluginSlug,
            file: relFile,
            line: li + 1,
            col: (m.index ?? 0) + 1,
            message:
              `${what} in a view-tool component. Sandboxed MCP App iframes ` +
              `block raw anchor navigation and window.open, so the click is a ` +
              `dead no-op. Route external links through the host bridge: render ` +
              `the shared <ExternalLink href={url}> component, or a ` +
              `<button onClick={() => useAppsClient().openLink(url)}>. ` +
              `See plugins/agntux-build/agents/ui-handler-author.md §1.7 and ` +
              `the ExternalLink template under ` +
              `plugins/agntux-build/canonical/ui-handlers/_template/view-tool/` +
              `src/components/external-link.tsx.`,
          });
        }
      }
    }
  }
}
