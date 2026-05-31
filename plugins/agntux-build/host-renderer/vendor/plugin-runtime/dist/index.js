// =============================================================================
// @agntux/plugin-runtime — public barrel.
//
// This package's surface is INTENTIONALLY narrow. Compiled view-tool modules
// `import` only from here; esbuild externalises the package so the bundle has
// no other runtime imports. The trust-model contract therefore boils down to
// the symbols listed below.
//
// NOTABLE OMISSION — `createLocalFsContext` / `resolveAgntuxRoot` are NOT
// re-exported from this root barrel. They live behind the subpath
// `@agntux/plugin-runtime/local-fs` so the S3 factory in `app/lib/mcp/runtime/`
// cannot accidentally import them. See `src/local-fs.ts` for the gated
// surface and `src/context.ts` for the FROZEN ViewToolContext contract.
// =============================================================================
export { mergeScope, ViewToolFsError } from "./context.js";
export { extractFencedYaml, extractFrontmatterMetadata, extractSection, parseActionFile, parseComposePayload, parseFrontmatter, } from "./parse-action.js";
export { DataPathSchema, HandlerModuleRegex, HtmlPathRegex, McpAppMetaSchema, McpUiCspSchema, McpUiPermissionsSchema, MutationToolSchema, ScopeSchema, UiBundleSchema, UiResourceUriRegex, ViewToolSchema, ViewToolsManifestSchema, } from "./manifest-schema.js";
// --- Canonical wording for the view-tool response envelope -----------------
// Centralizes the `content[].text` block every view-tool handler returns
// alongside `structuredContent` so the model has an explicit mental model
// of the MCP Apps lifecycle. See `render-confirmation.ts` for the rationale
// (Claude Cowork post-render commentary / duplicate-widget regression).
export { renderConfirmationText } from "./render-confirmation.js";
