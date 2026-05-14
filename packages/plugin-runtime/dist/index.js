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
export { extractSection, parseActionFile, parseFrontmatter, } from "./parse-action.js";
export { DataPathSchema, HandlerModuleRegex, HtmlPathRegex, McpAppMetaSchema, ScopeSchema, UiBundleSchema, UiResourceUriRegex, ViewToolSchema, ViewToolsManifestSchema, } from "./manifest-schema.js";
