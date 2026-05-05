// =============================================================================
// Triage UI bundle descriptor.
//
// The base64 placeholder below is replaced at build time by
// scripts/embed-bundle.mjs after `tsc` emits dist/ui-resources/triage.js.
// The ui-handlers/triage/component/out/index.html is read, base64-encoded, and
// substituted in-place inside the compiled JS. The CI guard
// scripts/check-bundle-sync.mjs fails the build if the embed is stale or
// missing.
//
// At runtime, ui-resources.ts reads the (substituted) base64 and decodes it
// when the host requests `resources/read` on `ui://triage`.
// =============================================================================

export const TRIAGE_UI_NAME = "triage" as const;
export const TRIAGE_RESOURCE_URI = "ui://triage" as const;
export const TRIAGE_MIME_TYPE = "text/html;profile=mcp-app" as const;

// __EMBED__triage__INDEX_HTML__ — replaced by embed-bundle.mjs at build time.
// During development before the first build, the placeholder string is what
// you'll see; resources/read will fail with a graceful structured error since
// base64-decoding a non-base64 string yields garbage HTML the host won't render.
export const triageBundleBase64Placeholder = "__EMBED__triage__INDEX_HTML__";

export const triageBundleDescriptor = {
  uri: TRIAGE_RESOURCE_URI,
  mimeType: TRIAGE_MIME_TYPE,
} as const;
