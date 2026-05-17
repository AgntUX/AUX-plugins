/**
 * lint-view-tool-css-bundle.ts — pass 13: every plugin whose view-tool
 * source uses `className=` on any element MUST ship CSS bundled into
 * its emitted HTML resources.
 *
 * Why this exists: the iframe served at `ui://…` loads ONLY the
 * inlined HTML document; external stylesheets are not fetched (and
 * `vite-plugin-singlefile` doesn't emit any external assets anyway).
 * A view-tool that author-time uses Tailwind utility classes —
 * `p-4`, `text-lg`, `font-semibold`, … — but ships an HTML resource
 * with no `<style>` block renders as unstyled HTML. The React tree
 * is intact, but the browser shows what looks like a raw text dump
 * because `<div>` / `<h1>` / `<p>` flow as user-agent-default blocks.
 *
 * This regression shipped to all three view-tool plugins
 * (agntux-core triage, agntux-slack compose+canvas, agntux-gmail
 * compose) before it was caught by a user. Pass 13 makes the bug
 * structurally hard to ship again: any plugin whose `*-ui.tsx`
 * sources reference `className=` must emit an HTML resource
 * containing a non-empty inline stylesheet.
 *
 * Findings:
 *
 *   E28 (warning) — view-tool source uses className= but emitted HTML
 *     resource has no inline <style> block.
 *
 *     The check is intentionally loose at the "is there CSS" end:
 *     any non-empty `<style …>…</style>` block counts. We don't
 *     verify which classes resolve to which rules — that's a
 *     visual regression that has to be caught by manual QA / the
 *     emerging screenshot harness. The point of this pass is to
 *     catch the "Vite never built any CSS at all" failure mode
 *     that produced the 9.5.7-class bug.
 *
 *     Severity is warning (not error) for the initial rollout — the
 *     three existing plugins ship without CSS today and we want
 *     the lint to surface on PRs without blocking unrelated work.
 *     Promote to error after all three plugins are updated to
 *     include `globals.css` + `@tailwindcss/vite` per the canonical
 *     template.
 *
 * Scope:
 *   - Runs against any plugin with a `view-tool/` directory that
 *     also ships a `view-tool/dist/ui-resources/*.html` resource.
 *   - Skips plugins whose `*-ui.tsx` sources don't use `className=`
 *     at all (a hypothetical view-tool that styles via inline
 *     `style={…}` only, or doesn't style anything, is fine).
 *   - Skips plugins without `view-tool/` entirely.
 *   - The canonical _template under
 *     `plugins/agntux-build/canonical/ui-handlers/_template/view-tool/`
 *     is NOT linted (it's not a real plugin's view-tool).
 *
 * Known limitations:
 *   - className= discovery only scans top-level `*-ui.tsx` entries.
 *     If a future plugin moves styled JSX into a subcomponent (e.g.
 *     `view-tool/src/components/Row.tsx`) while keeping the entry
 *     `*-ui.tsx` style-free, this pass silently passes. The convention
 *     today is single-file iframe entries; recurse `src/` if that
 *     ever changes. Worth addressing before promoting E28 to error.
 *
 * Detection budget:
 *   - Read each `*-ui.tsx` source fully — small files (~50–150 LoC).
 *   - Read each emitted HTML resource fully — the inlined bundle
 *     can be hundreds of KB but we only inspect for `<style>`
 *     bookends, which we can find with a streaming-friendly regex
 *     on the full string. The pass runs once per plugin in CI; the
 *     extra ms is negligible.
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

const CLASSNAME_RE = /className\s*=/;
// Matches `<style …>…</style>` with non-empty content. `[\s\S]` lets
// the body span newlines. After extracting candidate blocks we strip
// CSS `/* … */` comments before checking for a real CSS token (`{`,
// `:`, `@`) — a `<style>/* nothing */</style>` block would otherwise
// pass the gate while emitting zero rules, which is what we're
// trying to catch.
const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
// Cheapest possible "this looks like real CSS" check: any of the
// three tokens that appear in every non-trivial stylesheet. Tailwind
// v4's emitted bundle contains thousands of `{`s and `:`s; a
// comment-only or whitespace-only body emits none of these.
const CSS_TOKEN_RE = /[{:@]/;

function hasNonEmptyStyleBlock(html: string): boolean {
  STYLE_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STYLE_BLOCK_RE.exec(html)) !== null) {
    const body = (m[1] ?? "").replace(CSS_COMMENT_RE, "");
    if (CSS_TOKEN_RE.test(body)) return true;
  }
  return false;
}

function listUiTsxSources(srcDir: string): string[] {
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    // Convention: every iframe entry source is named `*-ui.tsx` so the
    // Vite HTML entry can reference it as `/src/{name}-ui.tsx`. Skip
    // the view-tool descriptor (`*-view.ts`) and library files.
    if (ent.name.endsWith("-ui.tsx")) {
      out.push(path.join(srcDir, ent.name));
    }
  }
  return out;
}

function anySourceUsesClassName(sources: string[]): boolean {
  for (const src of sources) {
    let body: string;
    try {
      body = fs.readFileSync(src, "utf8");
    } catch {
      continue;
    }
    if (CLASSNAME_RE.test(body)) return true;
  }
  return false;
}

export function pass13ViewToolCssBundle(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const rel = (p: string): string => path.relative(repoRoot, p);
  const viewToolDir = path.join(pluginDir, "view-tool");
  if (!fs.existsSync(viewToolDir) || !fs.statSync(viewToolDir).isDirectory()) {
    return;
  }
  const srcDir = path.join(viewToolDir, "src");
  const sources = listUiTsxSources(srcDir);
  if (sources.length === 0) return;
  if (!anySourceUsesClassName(sources)) return;

  const distDir = path.join(viewToolDir, "dist", "ui-resources");
  if (!fs.existsSync(distDir)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(distDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith(".html")) continue;
    const full = path.join(distDir, ent.name);

    let body: string;
    try {
      body = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (hasNonEmptyStyleBlock(body)) continue;

    findings.push({
      code: "E28",
      severity: "warning",
      plugin: pluginSlug,
      file: rel(full),
      message:
        `${ent.name} contains no inline <style> block, but the view-tool ` +
        `source uses className= (Tailwind / utility-class styling). ` +
        `The iframe loads only the inlined HTML — external stylesheets are ` +
        `never fetched — so CSS must be inlined by Vite. Without it the ` +
        `iframe renders as unstyled HTML that looks like a raw text dump.\n` +
        `Fix: add @tailwindcss/vite (or any CSS pipeline) to view-tool/ ` +
        `devDependencies, register the plugin in view-tool/vite.config.ts, ` +
        `create view-tool/src/globals.css with @import "tailwindcss";, ` +
        `and import "./globals.css" at the top of each *-ui.tsx. See ` +
        `plugins/agntux-build/canonical/ui-handlers/_template/view-tool/ ` +
        `for the canonical shape.`,
    });
  }
}
