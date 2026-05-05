// =============================================================================
// Canvas UI bundle descriptor.
//
// The base64 placeholder below is replaced at build time by
// scripts/embed-bundle.mjs after `tsc` emits dist/ui-resources/canvas.js.
// The ui-handlers/canvas/component/out/index.html is read, base64-encoded, and
// substituted in-place inside the compiled JS. The CI guard
// scripts/check-bundle-sync.mjs fails the build if the embed is stale or
// missing.
//
// At runtime, ui-resources.ts reads the (substituted) base64 and decodes it
// when the host requests `resources/read` on `ui://slack-canvas`.
// =============================================================================

export const CANVAS_UI_NAME = "slack-canvas" as const;
export const CANVAS_RESOURCE_URI = "ui://slack-canvas" as const;
export const CANVAS_MIME_TYPE = "text/html;profile=mcp-app" as const;

// __EMBED__canvas__INDEX_HTML__ — replaced by embed-bundle.mjs at build time.
// The embed script keys bundles by the ui-handlers directory name ("canvas"),
// NOT by the resource URI scheme ("slack-canvas"). The placeholder token must
// match the directory name exactly for the embed script's regex to resolve it.
// During development before the first build, the placeholder string is what
// you'll see; resources/read will fail with a graceful structured error since
// base64-decoding a non-base64 string yields garbage HTML the host won't render.
export const canvasBundleBase64Placeholder = "__EMBED__canvas__INDEX_HTML__";

export const slackCanvasBundleDescriptor = {
  uri: CANVAS_RESOURCE_URI,
  mimeType: CANVAS_MIME_TYPE,
} as const;
