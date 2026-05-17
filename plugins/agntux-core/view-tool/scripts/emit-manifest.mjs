#!/usr/bin/env node
// =============================================================================
// emit-manifest.mjs — emits dist/view-tools.manifest.json for agntux-core.
// Copied byte-identical from the canonical template
// (canonical/ui-handlers/_template/view-tool/scripts/emit-manifest.mjs).
// Plugin-specific behaviour lives in the compiled handler module and
// listing.yaml; this script is generic.
// =============================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";
import { ViewToolsManifestSchema } from "@agntux/plugin-runtime";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEW_TOOL_ROOT = resolve(__dirname, "..");
const PLUGIN_ROOT = resolve(VIEW_TOOL_ROOT, "..");
const DIST = resolve(VIEW_TOOL_ROOT, "dist");

const pluginJsonPath = resolve(PLUGIN_ROOT, ".claude-plugin", "plugin.json");
if (!existsSync(pluginJsonPath)) {
  console.error(`[emit-manifest] missing ${pluginJsonPath}`);
  process.exit(1);
}
const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf8"));
const slugKebab = pluginJson.name;
const slugSnake = slugKebab.replace(/-/g, "_");
const handlerModuleName = `${slugKebab}-view.js`;
const compiledHandler = resolve(DIST, handlerModuleName);
if (!existsSync(compiledHandler)) {
  console.error(`[emit-manifest] missing compiled handler ${compiledHandler}`);
  process.exit(1);
}

const mod = await import(pathToFileURL(compiledHandler).href);
const viewTools = mod.default?.viewTools;
if (!Array.isArray(viewTools) || viewTools.length === 0) {
  console.error(
    `[emit-manifest] ${handlerModuleName} must default-export { viewTools: ViewTool[] } (non-empty)`,
  );
  process.exit(1);
}

const listingPath = resolve(PLUGIN_ROOT, "marketplace", "listing.yaml");
if (!existsSync(listingPath)) {
  console.error(`[emit-manifest] missing ${listingPath}`);
  process.exit(1);
}
const listing = yaml.load(readFileSync(listingPath, "utf8"));
const uxComponents = Array.isArray(listing?.ui_components)
  ? listing.ui_components
  : Array.isArray(listing?.ux_components)
  ? listing.ux_components
  : [];

const matches = [];
for (const vt of viewTools) {
  const match = uxComponents.find(
    (uc) =>
      uc.view_tool === vt.descriptor.name &&
      uc.resource_uri === vt.descriptor.ui_resource_uri,
  );
  if (!match) {
    console.error(
      `[emit-manifest] view_tools[].name=${vt.descriptor.name} ui_resource_uri=${vt.descriptor.ui_resource_uri} has no matching listing.yaml ux_components[] entry.`,
    );
    process.exit(1);
  }
  if (!vt.descriptor.name.startsWith(`${slugSnake}_`)) {
    console.error(
      `[emit-manifest] view_tools[].name=${vt.descriptor.name} must be prefixed with plugin-slug-snake (${slugSnake}_).`,
    );
    process.exit(1);
  }
  matches.push(match);
}

const uiBundles = [];
const viewToolEntries = [];
const DEFAULT_CSP = {
  // `script_src` must allow `'unsafe-inline'` because vite-plugin-singlefile
  // inlines the UI bundle as `<script type="module">…</script>` directly in
  // the HTML. Under default-src 'self' alone (which is the script-src
  // fallback when script-src is absent), the host's CSP enforcer blocks
  // every inline <script>, the iframe renders an empty <div id="root">,
  // and the UI silently fails. `style_src` already carries 'unsafe-inline'
  // for the same reason (Vite inlines styles). `default_src 'self'`
  // restricts everything else (img/connect/font/etc.) — fonts are inlined
  // via data: URIs by the bundle so no font-src override is needed.
  default_src: ["'self'"],
  script_src: ["'self'", "'unsafe-inline'"],
  style_src: ["'self'", "'unsafe-inline'"],
};
const DEFAULT_PERMISSIONS = { allowFollowUp: true, allowFormSubmit: true };
const sidecarPath = resolve(VIEW_TOOL_ROOT, "mcp-app-meta.yaml");
const sidecar = existsSync(sidecarPath)
  ? (yaml.load(readFileSync(sidecarPath, "utf8")) ?? {})
  : {};

for (let i = 0; i < viewTools.length; i++) {
  const vt = viewTools[i];
  const match = matches[i];
  const resourceTail = basename(vt.descriptor.ui_resource_uri);
  const htmlPath = `view-tool/dist/ui-resources/${resourceTail}.html`;
  const absHtml = resolve(
    VIEW_TOOL_ROOT,
    "dist",
    "ui-resources",
    `${resourceTail}.html`,
  );
  if (!existsSync(absHtml)) {
    console.error(`[emit-manifest] missing built HTML ${absHtml}`);
    process.exit(1);
  }
  const sidecarEntry = sidecar[vt.descriptor.ui_resource_uri] ?? {};
  const csp = match.csp ?? sidecarEntry.csp ?? DEFAULT_CSP;
  const permissions =
    match.permissions ?? sidecarEntry.permissions ?? DEFAULT_PERMISSIONS;
  uiBundles.push({
    uri: vt.descriptor.ui_resource_uri,
    html_path: htmlPath,
    csp,
    permissions,
  });
  viewToolEntries.push({
    name: vt.descriptor.name,
    description: vt.descriptor.description,
    inputSchema: vt.descriptor.inputSchema,
    outputSchema: vt.descriptor.outputSchema,
    data_paths: vt.descriptor.data_paths ?? [
      { pattern: "actions/{id}.md", scope: "personal" },
    ],
    mcp_app_meta: {
      resourceUri: vt.descriptor.ui_resource_uri,
      csp,
      permissions,
    },
  });
}

const manifest = {
  plugin_slug: slugSnake,
  plugin_version: pluginJson.version,
  handler_module: `view-tool/dist/${handlerModuleName}`,
  view_tools: viewToolEntries,
  ui_bundles: uiBundles,
};
const parsed = ViewToolsManifestSchema.safeParse(manifest);
if (!parsed.success) {
  console.error("[emit-manifest] manifest failed Zod validation:");
  console.error(JSON.stringify(parsed.error.flatten(), null, 2));
  process.exit(1);
}
writeFileSync(
  resolve(DIST, "view-tools.manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8",
);
console.log(
  `[emit-manifest] wrote dist/view-tools.manifest.json (${viewToolEntries.length} view tools, ${uiBundles.length} ui bundles)`,
);
