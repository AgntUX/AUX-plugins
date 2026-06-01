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

import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

// ScrollablePanel's prop names as of the canonical primitive. Used as a FLOOR
// so the prop gate still works when the dist d.ts can't be read; the package's
// actual signature is unioned on top. Keep in sync with
// packages/agntux-ui-primitives/src/scrollable-panel.tsx (ScrollablePanelProps).
export const CANONICAL_SCROLLABLE_PANEL_PROPS = new Set([
  "title",
  "onDismiss",
  "onHelpClick",
  "helpLabel",
  "children",
  "footer",
  // React intrinsics always legal on any element:
  "key",
  "ref",
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

/**
 * Read ScrollablePanel's legal prop names from the bundled ui-primitives dist
 * d.ts (`export declare function ScrollablePanel({ a, b, … }: …)`) — a
 * machine-readable source of truth — unioned with the canonical floor. Returns
 * the floor alone when the d.ts is absent/unparseable (fail-open on the gate's
 * allow set, never fail-closed on a missing type file).
 */
function readScrollablePanelProps(packagesDir) {
  const props = new Set(CANONICAL_SCROLLABLE_PANEL_PROPS);
  const dts = join(packagesDir, "agntux-ui-primitives", "dist", "scrollable-panel.d.ts");
  try {
    const src = readFileSync(dts, "utf8");
    const m = src.match(/export\s+declare\s+function\s+ScrollablePanel\s*\(\s*\{([^}]*)\}/);
    if (m) {
      for (const raw of m[1].split(",")) {
        const id = raw.trim().match(/^([A-Za-z_$][\w$]*)/);
        if (id) props.add(id[1]);
      }
    }
  } catch {
    /* floor-only */
  }
  return props;
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

/** 1-based line number of a character offset in `src`. */
function lineAt(src, index) {
  let n = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") n++;
  return n;
}

/**
 * Replace the CONTENT of `//` + `/* *\/` comments and `'`/`"`/`` ` `` string
 * literals with spaces — preserving newlines AND length, so every character
 * offset and 1-based line number is unchanged. Run before the banned-construct
 * scan so a construct mentioned in a doc comment or a help/error string
 * (`"don't cast ComponentErrorBoundary as …"`) can't false-fail the build.
 * Quote bodies are blanked but the delimiters are kept, so `title="x"` stays
 * `title=" "` and the attribute structure survives. Pragmatic, not a full TS
 * tokenizer (regex literals aren't tracked — rare in view-tool TSX and harmless
 * if left intact); escapes are honoured so an escaped quote never ends a string.
 */
export function stripCommentsAndStrings(src) {
  const s = String(src);
  const blank = (ch) => (ch === "\n" ? "\n" : " ");
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    const c2 = s[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && s[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && c2 === "*") {
      out += "  "; i += 2;
      while (i < n && !(s[i] === "*" && s[i + 1] === "/")) { out += blank(s[i]); i++; }
      if (i < n) { out += "  "; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += q; i++; // keep the opening delimiter
      while (i < n) {
        const ch = s[i];
        if (ch === "\\") {
          // blank the escape but preserve newline-ness of the escaped char
          out += " " + blank(s[i + 1] ?? " ");
          i += 2;
          continue;
        }
        if (ch === q) { out += q; i++; break; }
        out += blank(ch); i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * Extract the attributes of a JSX opening tag from its inner text (the span
 * AFTER `<ScrollablePanel` and BEFORE the closing `>`/`/>`). A tiny state
 * machine that skips over `="..."`, `='...'`, and `={…}` value regions so a
 * value can never be mistaken for an attribute name. Returns
 * `{ attrs: Array<{name, offset}>, hasSpread }` where `offset` is the
 * attribute name's index within `tagInner` (so the caller can report the
 * attribute's own line, not the tag's opening line). `hasSpread` true means a
 * `{...spread}` is present and the caller must NOT enforce the allow-list (the
 * spread can carry any legal prop). Bounded by the input length.
 */
export function extractJsxAttributeNames(tagInner) {
  const attrs = [];
  let hasSpread = false;
  const s = String(tagInner);
  let i = 0;
  const skipBraces = () => {
    // assumes s[i] === "{"
    let depth = 0;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { i++; return; }
      } else if (c === '"' || c === "'") {
        const q = c; i++;
        while (i < s.length && s[i] !== q) i++;
      }
    }
  };
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "{") {
      // attribute-position brace → a spread (`{...x}`) or stray expression.
      if (/^\{\s*\.\.\./.test(s.slice(i))) hasSpread = true;
      skipBraces();
      continue;
    }
    const idM = s.slice(i).match(/^[A-Za-z_$][\w$-]*/);
    if (!idM) { i++; continue; }
    const name = idM[0];
    const offset = i;
    i += name.length;
    // look past whitespace for an `=`
    let j = i;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (s[j] === "=") {
      attrs.push({ name, offset });
      i = j + 1;
      while (i < s.length && /\s/.test(s[i])) i++;
      const v = s[i];
      if (v === '"' || v === "'") {
        i++;
        while (i < s.length && s[i] !== v) i++;
        i++;
      } else if (v === "{") {
        skipBraces();
      } else {
        // bare value token (rare in JSX) — skip to next whitespace/end
        while (i < s.length && !/\s/.test(s[i])) i++;
      }
    } else {
      // boolean attribute (`<X disabled />`)
      attrs.push({ name, offset });
      i = j;
    }
  }
  return { attrs, hasSpread };
}

/**
 * Read-only scan for banned hand-authoring constructs that recur despite the
 * prose guidance in agents/view-tool-builder.md. These are NEVER auto-fixed —
 * they fail the gate fast and legibly BEFORE the slow vite build:
 *   - a `ComponentErrorBoundary as …` cast (it is a valid component; the cast
 *     IS the TS2786 error and was introduced as a wrong guess-fix).
 *   - a `<ScrollablePanel>` attribute outside the primitive's real prop set
 *     (e.g. a hallucinated `pluginSlug` → TS2322).
 * @returns {Array<{kind,name,detail,file,line}>}
 */
export function scanBannedConstructs(fileAbs, content, allowedPanelProps) {
  const violations = [];
  const rel = fileRel(fileAbs);
  // Scan over a copy with comment + string bodies blanked (offsets/lines
  // preserved) so a construct merely MENTIONED in a comment or string is never
  // flagged — only real code is.
  const scan = stripCommentsAndStrings(content);

  // 1. ComponentErrorBoundary cast ban.
  const castRe = /\bComponentErrorBoundary\s+as\b/g;
  for (const m of scan.matchAll(castRe)) {
    violations.push({
      kind: "banned-cast",
      name: "ComponentErrorBoundary",
      file: rel,
      line: lineAt(scan, m.index),
      detail:
        "ComponentErrorBoundary must not be cast (`as …`) — it is already a " +
        "valid JSX class component; the cast is the TS2786/TS2352 error. Use " +
        "it directly: <ComponentErrorBoundary>…</ComponentErrorBoundary>.",
    });
  }

  // 1b. ComponentErrorBoundary type-only import ban. A value used as JSX must be
  //     imported as a VALUE; `import type {…ComponentErrorBoundary…}` or an inline
  //     `import { type ComponentErrorBoundary }` makes it a TYPE — using it as JSX
  //     is the same TS2786 "cannot be used as a JSX component" error as the cast,
  //     and the cast regex above doesn't see it. Fail it here, before vite/tsc.
  const typeImportRe =
    /import\s+type\s*\{[^}]*\bComponentErrorBoundary\b[^}]*\}|import\s*\{[^}]*\btype\s+ComponentErrorBoundary\b[^}]*\}/g;
  for (const m of scan.matchAll(typeImportRe)) {
    violations.push({
      kind: "banned-type-import",
      name: "ComponentErrorBoundary",
      file: rel,
      line: lineAt(scan, m.index),
      detail:
        "ComponentErrorBoundary must be imported as a VALUE, not a type — " +
        '`import type { ComponentErrorBoundary }` / `import { type ComponentErrorBoundary }` ' +
        "makes it a type, and using it as JSX is the TS2786 error. Use " +
        '`import { ComponentErrorBoundary } from "@agntux/ui-primitives"`.',
    });
  }

  // 2. ScrollablePanel prop allow-list. Find each `<ScrollablePanel` opening
  //    tag (word-boundary so `<ScrollablePanelFoo` is ignored), isolate its
  //    opening-tag inner text, and flag any attribute not in the allow-list.
  const openRe = /<ScrollablePanel(?=[\s/>])/g;
  for (const m of scan.matchAll(openRe)) {
    const start = m.index + "<ScrollablePanel".length;
    const inner = sliceOpeningTag(scan, start);
    if (inner == null) continue;
    const { attrs, hasSpread } = extractJsxAttributeNames(inner);
    if (hasSpread) continue; // a spread can legally supply any prop — don't guess
    for (const { name, offset } of attrs) {
      if (!allowedPanelProps.has(name) && !name.startsWith("data-") && !name.startsWith("aria-")) {
        violations.push({
          kind: "unknown-prop",
          name: `ScrollablePanel.${name}`,
          file: rel,
          // the attribute's own line, not the tag's opening line
          line: lineAt(scan, start + offset),
          detail:
            `<ScrollablePanel> has no \`${name}\` prop. Legal props are ` +
            `{ ${[...allowedPanelProps].filter((p) => !["key", "ref"].includes(p)).join(", ")} }. ` +
            "Put primary actions in `footer`; there is no `pluginSlug`/`StickyFooter`.",
        });
      }
    }
  }
  return violations;
}

/**
 * Return the opening-tag inner text starting at `start` (just after the tag
 * name), up to the closing `>` / `/>` at brace+quote depth 0. Returns null if
 * no terminator is found within a sane bound. String- and brace-aware so a `>`
 * inside `={…}` or a string never closes the tag early.
 */
function sliceOpeningTag(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < src.length && src[i] !== q) i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (c === ">" && depth === 0) {
      let end = i;
      if (src[i - 1] === "/") end = i - 1; // self-closing
      return src.slice(start, end);
    }
  }
  return null;
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
  const panelProps = readScrollablePanelProps(pkgDir);

  const files = collectSources(viewToolSrc);
  const allRejects = [];
  const allReroutes = [];
  const allViolations = [];
  for (const file of files) {
    const r = processFile(file, viewToolSrc, uiAllow, appsHooks);
    allRejects.push(...r.rejects.map((x) => ({ ...x, file: fileRel(file) })));
    allReroutes.push(...r.reroutes);
    if (r.rewritten && fix && r.rejects.length === 0) {
      writeFileSync(file, r.body, "utf8");
    }
    // Banned-construct scan runs on the FINAL content (post any --fix rewrite),
    // since that is what the build compiles. Read-only — never auto-fixed.
    allViolations.push(...scanBannedConstructs(file, r.body, panelProps));
  }

  const hallucinated = allRejects.length > 0;
  // In --check mode a wrong-source import that --fix WOULD rewrite is also a
  // failure (the tree is not clean as committed).
  const dirtyInCheck = !fix && allReroutes.length > 0;
  return {
    ok: !hallucinated && !dirtyInCheck && allViolations.length === 0,
    rejects: allRejects,
    reroutes: allReroutes,
    violations: allViolations,
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

// Run the CLI only when invoked directly. Resolve BOTH sides with realpathSync
// (symlink- + space-safe): Node realpath-resolves import.meta.url while argv[1]
// is the raw invocation path, so a raw `import.meta.url === pathToFileURL(
// argv[1]).href` compare misses under a symlinked/spaced path. Mirrors
// validate-plugin.mjs's isMainModule guard (Part G2 straggler sweep).
function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
if (isMainModule()) {
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
  if (result.violations && result.violations.length) {
    for (const v of result.violations) {
      console.error(`check-view-tool-imports: ${v.file}:${v.line}: ${v.detail}`);
    }
    console.log(
      JSON.stringify({
        ok: false,
        failed_stage: "build",
        routing: "view-tool-builder",
        detail: `banned view-tool construct(s): ${result.violations.map((v) => v.name).join(", ")}`,
      }),
    );
    process.exit(1);
  }
  if (!result.ok) process.exit(1);
  process.exit(0);
}
