// =============================================================================
// View-tool manifest schema — single source of truth shared by:
//   - agntux-build's `emit-manifest.mjs` (Phase 5) — emits the JSON
//   - app/lib/plugin-registry/manifest.ts (Phase 3) — re-exports this schema
//   - the remote plugin registry — validates manifests on download
//
// Per Sub-plan 3 Decision F. Phase 3 currently vendors a copy at
// `app/lib/plugin-registry/manifest-schema.ts`; Sub-plan 4 (this file)
// publishes the canonical version, and Phase 3's `manifest.ts` becomes a
// thin re-export of `@agntux/plugin-runtime`.
//
// Shapes MUST stay identical to the vendored copy — Phase 3's tests pin
// the Zod refinements and regex literals. If you change anything here,
// update the vendored copy in the same PR (or delete it in favour of the
// re-export) and re-run Phase 3's manifest tests.
// =============================================================================

import { z } from "zod";

export const ScopeSchema = z.enum(["personal", "team", "leader-view"]);
export type Scope = z.infer<typeof ScopeSchema>;

// Passthrough — we don't validate JsonSchema-of-JsonSchema here. The registry
// trusts the build that emitted the manifest.
const JsonSchemaShape = z.record(z.unknown());

export const DataPathSchema = z.object({
  pattern: z.string().min(1),
  scope: ScopeSchema,
});

// MCP App resource URIs: `ui://<plugin-slug-kebab>/<component-name-kebab>`.
// Both halves are lower-kebab; the leading letter must be a-z.
export const UiResourceUriRegex = /^ui:\/\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;

// Decision D: mcp_app_meta is pre-joined at build time into each view_tools[]
// entry so the runtime never has to walk `ui_bundles[]` to emit `_meta.ui`.
export const McpAppMetaSchema = z.object({
  resourceUri: z.string().regex(UiResourceUriRegex),
  csp: z.record(z.unknown()),
  permissions: z.record(z.unknown()),
});

export const ViewToolSchema = z.object({
  // Snake_case, plugin-prefixed (master plan §"Shared contracts §7").
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().min(1),
  inputSchema: JsonSchemaShape,
  outputSchema: JsonSchemaShape,
  mcp_app_meta: McpAppMetaSchema,
  // Decision C: REQUIRED, non-empty. Plugins that omit `data_paths` are
  // rejected at parse time.
  data_paths: z.array(DataPathSchema).min(1),
});

// Decision B: ONE compiled module per plugin. `handler_module` is the path
// to that ESM file relative to the plugin root; it exports
// `default: { viewTools: ViewTool[] }`.
//
// Path-traversal guard: the character class `[\w./-]+` allows `.` so a
// literal `..` segment would otherwise slip through. We forbid any path
// containing a `..` segment (boundary-anchored) to keep handler_module
// rooted under view-tool/dist/. Same guard applies to HtmlPathRegex.
export const NoParentSegment = /(^|\/)\.\.(\/|$)/;
export const HandlerModuleRegex = /^view-tool\/dist\/[\w./-]+\.js$/;
export const HtmlPathRegex = /^view-tool\/dist\/ui-resources\/[\w./-]+\.html$/;

export const HandlerModulePath = z
  .string()
  .regex(HandlerModuleRegex)
  .refine((p) => !NoParentSegment.test(p), {
    message: "handler_module must not contain '..' path segments",
  });

export const HtmlPath = z
  .string()
  .regex(HtmlPathRegex)
  .refine((p) => !NoParentSegment.test(p), {
    message: "html_path must not contain '..' path segments",
  });

export const UiBundleSchema = z.object({
  uri: z.string().regex(UiResourceUriRegex),
  html_path: HtmlPath,
  csp: z.record(z.unknown()),
  permissions: z.record(z.unknown()),
});

export const ViewToolsManifestSchema = z
  .object({
    // snake_case slug — matches tool-name prefix. The on-disk directory in
    // AUX-plugins is kebab-case; the github fetch layer translates.
    plugin_slug: z.string().regex(/^[a-z][a-z0-9_]*$/),
    plugin_version: z.string().min(1),
    handler_module: HandlerModulePath,
    view_tools: z.array(ViewToolSchema).min(1),
    ui_bundles: z.array(UiBundleSchema).min(1),
  })
  .refine(
    (m) =>
      m.view_tools.every((vt) =>
        m.ui_bundles.some((b) => b.uri === vt.mcp_app_meta.resourceUri),
      ),
    {
      message:
        "every view_tools[].mcp_app_meta.resourceUri must have a matching ui_bundles[] entry",
    },
  );

export type ViewToolsManifest = z.infer<typeof ViewToolsManifestSchema>;
export type DataPath = z.infer<typeof DataPathSchema>;
export type McpAppMeta = z.infer<typeof McpAppMetaSchema>;
export type ViewToolEntry = z.infer<typeof ViewToolSchema>;
export type UiBundleEntry = z.infer<typeof UiBundleSchema>;
