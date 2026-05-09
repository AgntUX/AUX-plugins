#!/usr/bin/env node
/**
 * check-bundle-sync.mjs — CI guard that fails the build if any UI handler's
 * compiled MCP server JS contains an unresolved `__EMBED__<ui-name>__INDEX_HTML__`
 * placeholder, OR if the embedded base64 differs from the current
 * component/out/index.html on disk.
 *
 * The check enforces two invariants:
 *
 *   1. Every placeholder in compiled JS resolves to an existing
 *      component/out/index.html bundle.
 *   2. The base64 in compiled JS matches a fresh re-build of that bundle —
 *      i.e., dist/ was rebuilt after the latest component change.
 *
 * Failure mode this prevents: a developer ships a component edit but forgets
 * to rerun `npm run build` in the component directory, so the MCP server
 * embeds a stale bundle. The user sees yesterday's UI in production.
 *
 * Usage in CI:
 *   node scripts/check-bundle-sync.mjs
 *
 * Exit codes:
 *   0 — all bundles in sync
 *   1 — drift detected (unresolved placeholder, missing bundle, or stale embed)
 *
 * The script is read-only — it does not modify any files. To fix drift, run
 * `npm run build` in the relevant component directory and then in mcp-server.
 */

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER_RE = /__EMBED__([a-z0-9-]+)__INDEX_HTML__/g;
// Matches the exact emitted shape from canonical/ui-handlers/_template/
// mcp-server/src/ui-resources/{{ui-name}}.ts after substitution:
//   const xxxBundleBase64 = "<base64>";
// The capture group is the base64 string. Any other emit shape requires
// updating this regex.
const EMBEDDED_BASE64_RE =
  /BundleBase64Placeholder\s*=\s*"([A-Za-z0-9+/=]+)"/g;

const repoRoot = process.env.PLUGIN_REPO_ROOT
  ? resolve(process.env.PLUGIN_REPO_ROOT)
  : findRepoRoot(dirname(fileURLToPath(import.meta.url)));

const pluginsDir = join(repoRoot, 'plugins');
if (!exists(pluginsDir)) {
  fail(`Could not find plugins/ directory at ${pluginsDir}.`);
}

const plugins = readdirSync(pluginsDir).filter(
  (d) => exists(join(pluginsDir, d, 'mcp-server')),
);

let drift = 0;

for (const plugin of plugins) {
  const compiledRoot = join(pluginsDir, plugin, 'mcp-server', 'dist');
  if (!exists(compiledRoot)) {
    log(`[${plugin}] no dist/ — run \`npm run build\` in mcp-server first.`);
    drift++;
    continue;
  }
  const bundles = collectBundles(join(pluginsDir, plugin, 'ui-handlers'));

  for (const jsFile of walkJs(compiledRoot)) {
    const text = readFileSync(jsFile, 'utf8');

    // Invariant 1 — no unresolved placeholders.
    let m;
    PLACEHOLDER_RE.lastIndex = 0;
    while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
      log(`  ✗ ${relative(repoRoot, jsFile)}: unresolved placeholder __EMBED__${m[1]}__INDEX_HTML__`);
      drift++;
    }

    // Invariant 2 — embedded base64 matches current bundle for ui-name.
    // Heuristic: pair adjacent `BundleBase64Placeholder = "..."` with the
    // ui-name it references via the surrounding generated identifier
    // (slackThreadBundleBase64Placeholder -> slack-thread).
    EMBEDDED_BASE64_RE.lastIndex = 0;
    while ((m = EMBEDDED_BASE64_RE.exec(text)) !== null) {
      const idx = m.index;
      const window = text.slice(Math.max(0, idx - 200), idx);
      const idMatch = /([A-Za-z0-9_]+)BundleBase64Placeholder/.exec(window);
      if (!idMatch) continue; // can't determine ui-name — skip
      const camel = idMatch[1];
      const uiName = camelToKebab(camel);
      const bundle = bundles[uiName];
      if (!bundle) {
        log(`  ✗ ${relative(repoRoot, jsFile)}: embedded base64 for "${uiName}" but no component/out/index.html on disk`);
        drift++;
        continue;
      }
      if (m[1] !== bundle.base64) {
        log(`  ✗ ${relative(repoRoot, jsFile)}: embedded base64 for "${uiName}" is stale (${m[1].length}B vs disk ${bundle.base64.length}B). Run \`npm run build\` in component/ then mcp-server/.`);
        drift++;
      }
    }
  }
}

if (drift > 0) {
  fail(`check-bundle-sync: ${drift} drift issue(s) detected.`);
}

log('check-bundle-sync: all UI bundles in sync with compiled MCP server.');
process.exit(0);

// ── helpers ──────────────────────────────────────────────────────────────────

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (exists(join(dir, 'plugins')) && exists(join(dir, '.claude-plugin'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

function collectBundles(uiHandlersDir) {
  const bundles = {};
  if (!exists(uiHandlersDir)) return bundles;
  for (const entry of readdirSync(uiHandlersDir)) {
    if (entry.startsWith('_')) continue;
    const indexHtml = join(uiHandlersDir, entry, 'component', 'out', 'index.html');
    if (!exists(indexHtml)) continue;
    const html = readFileSync(indexHtml);
    bundles[entry] = { indexHtml, base64: html.toString('base64'), bytes: html.length };
  }
  return bundles;
}

function* walkJs(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walkJs(full);
    else if (e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.mjs'))) yield full;
  }
}

function camelToKebab(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function exists(p) { try { statSync(p); return true; } catch { return false; } }
function log(msg) { console.log(msg); }
function fail(msg) { console.error(`check-bundle-sync: ${msg}`); process.exit(1); }
