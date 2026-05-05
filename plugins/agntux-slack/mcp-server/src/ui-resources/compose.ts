// =============================================================================
// Compose UI bundle descriptor.
//
// The base64 placeholder below is replaced at build time by
// scripts/embed-bundle.mjs after `tsc` emits dist/ui-resources/compose.js.
// The ui-handlers/compose/component/out/index.html is read, base64-encoded, and
// substituted in-place inside the compiled JS. The CI guard
// scripts/check-bundle-sync.mjs fails the build if the embed is stale or
// missing.
//
// At runtime, ui-resources.ts reads the (substituted) base64 and decodes it
// when the host requests `resources/read` on `ui://slack-compose`.
// =============================================================================

export const COMPOSE_UI_NAME = "slack-compose" as const;
export const COMPOSE_RESOURCE_URI = "ui://slack-compose" as const;
export const COMPOSE_MIME_TYPE = "text/html;profile=mcp-app" as const;

// __EMBED__compose__INDEX_HTML__ — replaced by embed-bundle.mjs at build time.
// The embed script keys bundles by the ui-handlers directory name ("compose"),
// NOT by the resource URI scheme ("slack-compose"). The placeholder token must
// match the directory name exactly for the embed script's regex to resolve it.
// During development before the first build, the placeholder string is what
// you'll see; resources/read will fail with a graceful structured error since
// base64-decoding a non-base64 string yields garbage HTML the host won't render.
export const composeBundleBase64Placeholder = "__EMBED__compose__INDEX_HTML__";

export const slackComposeBundleDescriptor = {
  uri: COMPOSE_RESOURCE_URI,
  mimeType: COMPOSE_MIME_TYPE,
} as const;
