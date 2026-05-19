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

// --- Cross-environment runtime contract -------------------------------------
export type {
  JsonSchema,
  ListWithMetaEntry,
  MutationTool,
  MutationToolDescriptor,
  UpdatePatch,
  ViewTool,
  ViewToolContext,
  ViewToolDescriptor,
  ViewToolFs,
  ViewToolFsErrorCode,
  ViewToolModule,
  ViewToolScope,
  WriteFileOpts,
  WriteResult,
} from "./context.js";
export { mergeScope, ViewToolFsError } from "./context.js";

// --- parse-action helpers (pure functions, safe for handlers) ---------------
export type {
  ActionFile,
  ActionFrontmatter,
  ComposePayloadOnDisk,
  ComposePayloadThreadContext,
  ParsedAction,
  SuggestedActionRow,
} from "./parse-action.js";
export {
  extractFencedYaml,
  extractFrontmatterMetadata,
  extractSection,
  parseActionFile,
  parseComposePayload,
  parseFrontmatter,
} from "./parse-action.js";

// --- View-tool manifest schema (shared by Phase 3 + Phase 5) ----------------
export type {
  DataPath,
  McpAppMeta,
  McpUiCsp,
  McpUiPermissions,
  MutationToolEntry,
  Scope,
  UiBundleEntry,
  ViewToolEntry,
  ViewToolsManifest,
} from "./manifest-schema.js";
export {
  DataPathSchema,
  HandlerModuleRegex,
  HtmlPathRegex,
  McpAppMetaSchema,
  McpUiCspSchema,
  McpUiPermissionsSchema,
  MutationToolSchema,
  ScopeSchema,
  UiBundleSchema,
  UiResourceUriRegex,
  ViewToolSchema,
  ViewToolsManifestSchema,
} from "./manifest-schema.js";

// --- AgntuxRootPaths shape (defined alongside the local-fs factory) --------
// Type-only re-export; the factory itself is NOT exported here on purpose.
export type { AgntuxRootPaths } from "./local-fs.js";

// --- Canonical wording for the view-tool response envelope -----------------
// Centralizes the `content[].text` block every view-tool handler returns
// alongside `structuredContent` so the model has an explicit mental model
// of the MCP Apps lifecycle. See `render-confirmation.ts` for the rationale
// (Claude Cowork post-render commentary / duplicate-widget regression).
export { renderConfirmationText } from "./render-confirmation.js";
