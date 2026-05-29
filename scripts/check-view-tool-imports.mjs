#!/usr/bin/env node
/**
 * check-view-tool-imports.mjs — data-driven `@agntux/ui-primitives` import gate
 * (C1: end the import whack-a-mole).
 *
 * The recurring contributor-build failure class is a view-tool that imports a
 * symbol from `@agntux/ui-primitives` that the package does not export:
 *
 *   - an APPS HOOK (useHostStyleVariables, useToolResult, …) — a *real* symbol
 *     but from the wrong source: it lives in the vendored apps-react lib
 *     (`./lib/apps-react/index.js`), not in @agntux/ui-primitives. Auto-fixable
 *     by re-routing the import.
 *   - a HALLUCINATION (StickyFooter, buildConnectorEnvelope, …) — exported by
 *     NOTHING. Not auto-fixable; the build must fail closed with a clear,
 *     routed message rather than vite's cryptic "not exported by" error.
 *
 * Both fail the vite build, but only AFTER a slow compile and with an opaque
 * error. This pass runs BEFORE the build, sources its allow/deny sets from ONE
 * truth (the actual exports of the bundled @agntux/ui-primitives + the tree's
 * own apps-react lib), auto-re-routes the wrong-source case, and rejects the
 * hallucination case fast and legibly.
 *
 * Sources of truth (never hardcode the allow set):
 *   - ui-primitives exports  ← <packagesDir>/agntux-ui-primitives/dist/index.js
 *   - apps-react hook names   ← <tree>/view-tool/src/lib/apps-react/index.js|ts
 *                               (unioned with CANONICAL_APPS_EXPORTS as a floor,
 *                               so a tree missing the lib still classifies
 *                               correctly instead of mislabeling hooks as
 *                               hallucinations).
 *
 * Usage:
 *   node scripts/check-view-tool-imports.mjs --plugin-dir <abs> [--fix] [--packages-dir <abs>]
 *
 *   --fix          rewrite apps-hook imports to ./lib/apps-react/index.js and
 *                  rename useStructuredContent → assertStructuredContent in place
 *                  (default behaviour). Hallucinations still HARD-fail.
 *   --check        report only; never write. Exit non-zero on ANY issue
 *                  (wrong-source OR hallucination).
 *   --packages-dir override where @agntux/ui-primitives resolves (defaults to
 *                  the toolchain layout's packages dir).
 *
 * Exit codes:
 *   0  — clean (after any --fix rewrites), no hallucinated symbols
 *   1  — a hallucinated symbol was found (exported by nothing), OR --check found
 *        any wrong-source import that --fix would have rewritten
 *   2  — usage / environment error
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveToolchain } from "./toolchain-layout.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The apps-react value exports as of the canonical agntux-core lib. Used as a
// FLOOR so classification still works when a tree's own apps-react/index can't
// be read; the tree's actual exports are unioned on top. Keep in sync with
// plugins/agntux-core/view-tool/src/lib/apps-react/index.ts (value exports
// only — types are erased and never imported as values).
export const CANONICAL_APPS_EXPORTS = new Set([
  "AppsProvider",
  "useAppsContext",
  "useAppsClient",
  "useToolResult",
  "useToolInput",
  "useHostContext",
  "useWidgetState",
  "useHostStyleVariables",
  "useDocumentTheme",
  "useDisplayMode",
  "useSafeAreaInsets",
  "useOnToolCancelled",
  "useOnTeardown",
  "useDebugLogger",
  "useOnToolInputPartial",
  "useHostCapabilities",
  "useHostVersion",
  "useSizeChangedNotifications",
  "useUpdateModelContext",
  "useResourceMeta",
]);

const UI_PRIMITIVES = "@agntux/ui-primitives";
// The upstream package the vendored apps-react lib was inlined from — never a
// view-tool dependency. Every named import from it re-routes wholesale.
const UPSTREAM_APPS = "@mcp-apps-kit/ui-react";
const REROUTE_TARGET_BASENAME = "lib/apps-react/index.js";
const SOURCE_EXT = /\.(ts|tsx)$/;

/** Extract named (value) export identifiers from an index module body. */
export function extractExportNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
    // Skip `export type { … }` blocks wholesale (type-only).
    if (/export\s+type\s*\{/.test(m[0])) continue;
    for (const raw of m[1].split(",")) {
      const seg = raw.trim();
      if (!seg) continue;
      if (/^type\s+/.test(seg)) continue; // inline type-only specifier
      const asMatch = seg.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
      if (asMatch) {
        names.add(asMatch[1]);
        continue;
      }
      const id = seg.match(/^([A-Za-z_$][\w$]*)$/);
      if (id) names.add(id[1]);
    }
  }
  for (const m of src.matchAll(
    /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(m[1]);
  }
  return names;
}

/** Read the @agntux/ui-primitives export surface from its built dist index. */
function readUiPrimitivesExports(packagesDir) {
  const idx = join(packagesDir, "agntux-ui-primitives", "dist", "index.js");
  if (!existsSync(idx)) return null;
  return extractExportNames(readFileSync(idx, "utf8"));
}

/** Read the apps-react hook names from the tree's vendored lib (ts or compiled). */
function readAppsReactExports(viewToolSrc) {
  for (const ext of ["index.ts", "index.tsx", "index.js"]) {
    const p = join(viewToolSrc, "lib", "apps-react", ext);
    if (existsSync(p)) return extractExportNames(readFileSync(p, "utf8"));
  }
  return new Set();
}

/** Recursively collect .ts/.tsx files under dir (skip node_modules, dist). */
function collectSources(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      // Skip build output + the test tree: __tests__ fixtures may legitimately
      // import apps hooks in non-canonical ways, and the gate must never
      // rewrite test source.
      if (e.name === "node_modules" || e.name === "dist" || e.name === "__tests__") continue;
      collectSources(join(dir, e.name), acc);
    } else if (e.isFile() && SOURCE_EXT.test(e.name)) {
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

/** Parse the named specifiers of an `import { … }` clause body. */
function parseSpecifiers(clause) {
  return clause
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const typeOnly = /^type\s+/.test(seg);
      const body = seg.replace(/^type\s+/, "");
      const asMatch = body.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) return { source: asMatch[1], local: asMatch[2], typeOnly };
      const id = body.match(/^([A-Za-z_$][\w$]*)$/);
      return id ? { source: id[1], local: id[1], typeOnly } : null;
    })
    .filter(Boolean);
}

/** Compute the `./…/lib/apps-react/index.js` specifier for a file. */
function rerouteSpecifierFor(fileAbs, viewToolSrc) {
  const target = join(viewToolSrc, REROUTE_TARGET_BASENAME);
  let rel = relative(dirname(fileAbs), target).split("\\").join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function renderImportLine(names, source) {
  return `import { ${names.join(", ")} } from "${source}";`;
}

/**
 * Analyse (and optionally rewrite) one source file.
 * @returns {{ rewritten: boolean, rejects: Array<{name:string,source:string}>, reroutes: string[] }}
 */
export function processFile(fileAbs, viewToolSrc, uiAllow, appsHooks) {
  const before = readFileSync(fileAbs, "utf8");
  const rejects = [];
  const reroutes = [];
  const rerouteSpec = rerouteSpecifierFor(fileAbs, viewToolSrc);

  // Collect names that an EXISTING apps-react import already brings in, so we
  // merge rather than emit a duplicate import line.
  const existingReroute = new Set();
  // Line-anchored (`^[ \t]*` + `m`): only a real statement at line start
  // matches, so a commented-out `// import { … }` can never be mistaken for the
  // live import (which would otherwise corrupt the merge step).
  const importRe = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/gm;
  for (const m of before.matchAll(importRe)) {
    if (m[2].endsWith("lib/apps-react/index.js")) {
      for (const spec of parseSpecifiers(m[1])) existingReroute.add(spec.local);
    }
  }

  let body = before;

  // Rename the deprecated alias file-wide (import specifier AND call sites) —
  // renaming only the import would leave call sites referencing an undefined
  // binding. Gate on an ACTUAL ui-primitives import of the alias so a mere
  // mention in a comment or string literal is never rewritten.
  const hasDeprecatedImport =
    /^[ \t]*import\s*\{[^}]*\buseStructuredContent\b[^}]*\}\s*from\s*["']@agntux\/ui-primitives["']/m.test(before);
  if (hasDeprecatedImport) {
    body = body.replace(/\buseStructuredContent\b/g, "assertStructuredContent");
    reroutes.push(`${fileRel(fileAbs)}: useStructuredContent → assertStructuredContent`);
  }

  const mergedReroute = new Map(); // local -> specifier text (with alias if any)

  body = body.replace(importRe, (full, clause, source) => {
    if (source !== UI_PRIMITIVES && source !== UPSTREAM_APPS) return full;
    const specs = parseSpecifiers(clause);
    const keep = [];
    for (const spec of specs) {
      const srcName = spec.source;
      const localName = spec.local;
      const text = localName === srcName ? srcName : `${srcName} as ${localName}`;
      if (spec.typeOnly) {
        // Inline `type` specifier — never a value import. Preserve it verbatim
        // (with its `type ` prefix); never classify it as a hallucination or
        // re-route it.
        keep.push(`type ${text}`);
        continue;
      }
      const isAppsHook = appsHooks.has(srcName);
      const isUpstream = source === UPSTREAM_APPS;
      const isUiExport = uiAllow.has(srcName);

      if (isUpstream || isAppsHook) {
        // Wrong source — re-route to the vendored apps-react lib.
        if (!existingReroute.has(localName)) mergedReroute.set(localName, text);
        reroutes.push(`${fileRel(fileAbs)}: ${srcName} → ${rerouteSpec}`);
        continue;
      }
      if (isUiExport) {
        keep.push(text);
        continue;
      }
      // Exported by nothing — hallucination. Cannot auto-fix.
      rejects.push({ name: srcName, source });
      keep.push(text); // leave as-is so the error points at the real line
    }

    if (source === UPSTREAM_APPS) return ""; // whole statement re-routed away
    if (keep.length === 0) return "";
    return renderImportLine(keep, UI_PRIMITIVES);
  });

  // Emit/merge the apps-react import for re-routed names.
  if (mergedReroute.size > 0) {
    const names = [...mergedReroute.values()];
    const existingImportRe = new RegExp(
      `^[ \\t]*import\\s*\\{([^}]*)\\}\\s*from\\s*["'][^"']*lib/apps-react/index\\.js["'];?`,
      "m",
    );
    if (existingImportRe.test(body)) {
      body = body.replace(existingImportRe, (full, clause) => {
        const have = parseSpecifiers(clause).map((s) =>
          s.local === s.source ? s.source : `${s.source} as ${s.local}`,
        );
        const merged = [...new Set([...have, ...names])];
        return renderImportLine(merged, rerouteSpec);
      });
    } else {
      body = `${renderImportLine(names, rerouteSpec)}\n${body}`;
    }
  }

  // Tidy doubled blank lines a removed import may have left — ONLY when this
  // pass actually changed the file, so a file with pre-existing blank runs and
  // no import change stays a true no-op (idempotent).
  if (body !== before) body = body.replace(/\n{3,}/g, "\n\n");

  const rewritten = body !== before;
  return { rewritten, body, rejects, reroutes };
}

function fileRel(p) {
  return relative(process.cwd(), p);
}

export function run(pluginDir, { fix = true, packagesDir } = {}) {
  const treeAbs = resolve(pluginDir);
  const viewToolSrc = join(treeAbs, "view-tool", "src");
  if (!existsSync(viewToolSrc)) {
    return { ok: true, skipped: true, reason: "no view-tool/src/", rejects: [], reroutes: [] };
  }
  const tc = resolveToolchain(__dirname);
  const pkgDir = packagesDir ? resolve(packagesDir) : tc.packagesDir;
  const uiAllow = readUiPrimitivesExports(pkgDir);
  if (!uiAllow) {
    return {
      ok: false,
      fatal: `cannot read @agntux/ui-primitives exports under ${pkgDir} ` +
        `(dist/index.js missing) — failing closed rather than guessing the allow set`,
      rejects: [],
      reroutes: [],
    };
  }
  const appsHooks = new Set([
    ...CANONICAL_APPS_EXPORTS,
    ...readAppsReactExports(viewToolSrc),
  ]);

  const files = collectSources(viewToolSrc);
  const allRejects = [];
  const allReroutes = [];
  for (const file of files) {
    const r = processFile(file, viewToolSrc, uiAllow, appsHooks);
    allRejects.push(...r.rejects.map((x) => ({ ...x, file: fileRel(file) })));
    allReroutes.push(...r.reroutes);
    if (r.rewritten && fix && r.rejects.length === 0) {
      writeFileSync(file, r.body, "utf8");
    }
  }

  const hallucinated = allRejects.length > 0;
  // In --check mode a wrong-source import that --fix WOULD rewrite is also a
  // failure (the tree is not clean as committed).
  const dirtyInCheck = !fix && allReroutes.length > 0;
  return {
    ok: !hallucinated && !dirtyInCheck,
    rejects: allRejects,
    reroutes: allReroutes,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { pluginDir: undefined, fix: true, packagesDir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plugin-dir") out.pluginDir = argv[++i];
    else if (a.startsWith("--plugin-dir=")) out.pluginDir = a.slice("--plugin-dir=".length);
    else if (a === "--packages-dir") out.packagesDir = argv[++i];
    else if (a.startsWith("--packages-dir=")) out.packagesDir = a.slice("--packages-dir=".length);
    else if (a === "--fix") out.fix = true;
    else if (a === "--check") out.fix = false;
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pluginDir) {
    console.error("check-view-tool-imports: --plugin-dir <abs> is required");
    process.exit(2);
  }
  const result = run(args.pluginDir, { fix: args.fix, packagesDir: args.packagesDir });
  if (result.fatal) {
    console.error(`check-view-tool-imports: ${result.fatal}`);
    process.exit(2);
  }
  for (const r of result.reroutes) console.error(`check-view-tool-imports: ${r}`);
  if (result.rejects.length) {
    for (const j of result.rejects) {
      console.error(
        `check-view-tool-imports: ${j.file}: "${j.name}" is not exported by ${j.source} ` +
          `(or any package) — it does not exist. Remove it or use the real symbol.`,
      );
    }
    console.log(
      JSON.stringify({ ok: false, failed_stage: "build", detail: `unresolved imports: ${result.rejects.map((r) => r.name).join(", ")}` }),
    );
    process.exit(1);
  }
  if (!result.ok) process.exit(1);
  process.exit(0);
}
