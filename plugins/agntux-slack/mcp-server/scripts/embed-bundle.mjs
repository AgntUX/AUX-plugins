#!/usr/bin/env node
/**
 * embed-bundle.mjs — replace `__EMBED__<ui-name>__INDEX_HTML__` placeholders
 * in compiled MCP server JS with the base64 bundle from each UI handler's
 * component/out/index.html.
 *
 * Runs after `tsc` in the MCP server's build pipeline:
 *
 *   "scripts": {
 *     "build": "tsc -p tsconfig.json && node scripts/embed-bundle.mjs"
 *   }
 *
 * Discovery rules (paths are relative to this plugin's repo root):
 *
 *   1. UI handlers are at:        plugins/{slug}/ui-handlers/{ui-name}/
 *   2. Component bundle source:   plugins/{slug}/ui-handlers/{ui-name}/component/out/index.html
 *   3. Compiled MCP server JS:    plugins/{slug}/mcp-server/dist/**\/*.js
 *
 * The script:
 *   a. Walks the compiled JS tree.
 *   b. For every file, finds `__EMBED__<ui-name>__INDEX_HTML__` placeholders.
 *   c. Resolves each placeholder to its component/out/index.html, base64-encodes,
 *      and substitutes inline.
 *   d. Reports embed counts and exits 0 on success, 1 on any unresolved
 *      placeholder or missing bundle.
 *
 * The placeholder shape — `__EMBED__<ui-name>__INDEX_HTML__` — is intentionally
 * unique enough to never collide with user code. The exact tokens emitted by
 * the ui-resources fragment template (canonical/ui-handlers/_template/
 * mcp-server/src/ui-resources/{{ui-name}}.ts) are matched by the regex below.
 *
 * Usage:
 *   node scripts/embed-bundle.mjs
 *   node scripts/embed-bundle.mjs --plugin agntux-slack         # restrict to one plugin
 *   node scripts/embed-bundle.mjs --check                       # dry-run; fails if any embed needs updating
 *
 * Environment:
 *   PLUGIN_REPO_ROOT — overrides the autodetected repo root (default: walks up from cwd).
 */

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER_RE = /__EMBED__([a-z0-9-]+)__INDEX_HTML__/g;

const argv = parseArgs(process.argv.slice(2));
const repoRoot = process.env.PLUGIN_REPO_ROOT
  ? resolve(process.env.PLUGIN_REPO_ROOT)
  : findRepoRoot(dirname(fileURLToPath(import.meta.url)));

const pluginsDir = join(repoRoot, 'plugins');
if (!exists(pluginsDir)) {
  fail(`Could not find plugins/ directory at ${pluginsDir}. Set PLUGIN_REPO_ROOT to override.`);
}

const targetPlugins = argv.plugin
  ? [argv.plugin]
  : readdirSync(pluginsDir).filter((d) => exists(join(pluginsDir, d, 'mcp-server')));

if (targetPlugins.length === 0) {
  fail('No plugins with mcp-server/ directories found.');
}

let totalEmbeds = 0;
let unresolved = 0;
let modifiedFiles = 0;

for (const plugin of targetPlugins) {
  const compiledRoot = join(pluginsDir, plugin, 'mcp-server', 'dist');
  if (!exists(compiledRoot)) {
    log(`[${plugin}] no dist/ directory — skipping (run \`tsc\` first?)`);
    continue;
  }
  const bundles = collectBundles(join(pluginsDir, plugin, 'ui-handlers'));
  log(`[${plugin}] discovered ${Object.keys(bundles).length} UI bundle(s): ${Object.keys(bundles).join(', ') || '(none)'}`);

  for (const jsFile of walkJs(compiledRoot)) {
    const original = readFileSync(jsFile, 'utf8');
    const replaced = original.replace(PLACEHOLDER_RE, (_match, uiName) => {
      const bundle = bundles[uiName];
      if (!bundle) {
        log(`  ✗ ${relative(repoRoot, jsFile)}: missing bundle for ui-name "${uiName}"`);
        unresolved++;
        return _match;
      }
      totalEmbeds++;
      return bundle.base64;
    });

    if (replaced === original) continue;

    if (argv.check) {
      log(`  ! ${relative(repoRoot, jsFile)}: would embed (run without --check to apply)`);
      unresolved++;
    } else {
      writeFileSync(jsFile, replaced, 'utf8');
      modifiedFiles++;
      log(`  ✓ ${relative(repoRoot, jsFile)}: embeds applied`);
    }
  }
}

if (unresolved > 0) {
  fail(`embed-bundle: ${unresolved} unresolved placeholder(s) — see log above.`);
}

log(`embed-bundle: ${totalEmbeds} embed(s) across ${modifiedFiles} file(s).`);
process.exit(0);

// ── helpers ──────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--check') out.check = true;
    else if (a === '--plugin') out.plugin = args[++i];
    else if (a.startsWith('--plugin=')) out.plugin = a.slice('--plugin='.length);
  }
  return out;
}

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (exists(join(dir, 'plugins')) && exists(join(dir, '.claude-plugin'))) return dir;
    if (exists(join(dir, 'plugins')) && exists(join(dir, 'package.json'))) {
      try {
        const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        if (pj?.workspaces || pj?.name?.includes('plugin-dev')) return dir;
      } catch {}
    }
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
    if (entry.startsWith('_')) continue; // skip _template
    const indexHtml = join(uiHandlersDir, entry, 'component', 'out', 'index.html');
    if (!exists(indexHtml)) continue;
    const html = readFileSync(indexHtml);
    bundles[entry] = {
      indexHtml,
      base64: html.toString('base64'),
      bytes: html.length,
    };
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

function exists(p) {
  try { statSync(p); return true; } catch { return false; }
}

function log(msg) { console.log(msg); }
function fail(msg) { console.error(`embed-bundle: ${msg}`); process.exit(1); }
