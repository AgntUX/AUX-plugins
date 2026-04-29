// =============================================================================
// FRAGMENT — merge into the plugin's mcp-server/src/ui-resources.ts UI_PATHS map
// at substitution time (P6 generator).
//
// How to wire in:
//   In the target plugin's ui-resources.ts, add this entry to UI_PATHS:
//
//     import { fetchUIBundle, readRenderTokenFromLicense } from "./s3-fetch.js";
//
//     const UI_PATHS: Record<string, string> = {
//       ...slackThreadUIPaths,   // <- merged in by P6
//     };
//
// The generator (P6) expands {{plugin-slug}} to the concrete plugin slug
// (e.g., "slack-ingest") at substitution time.
// =============================================================================

// UI_PATHS fragment — one entry per UI component this handler ships.
// Key:   the ui:// URI the host will request via resources/read
// Value: the S3-relative path under the plugin's signed base URL
export const slackThreadUIPaths: Record<string, string> = {
  "ui://slack-thread": "slack-thread/index.html",
};

// Resource handler fragment — merged into the plugin's handleUIResource function.
// Returns the HTML bundle with _meta.license from the render token cache.
//
// Full ui-resources.ts shape (for reference — the generator owns this file):
//
//   export async function handleUIResource(uri: string) {
//     const path = UI_PATHS[uri];
//     if (!path) {
//       return { isError: true, contents: [{ type: "text", text: `Unknown UI resource: ${uri}` }] };
//     }
//     const html = await fetchUIBundle(path);
//     const license = readRenderTokenFromLicense();
//     return {
//       contents: [{
//         uri,
//         mimeType: "text/html;profile=mcp-app",
//         text: html,
//         _meta: {
//           ui: {
//             prefersBorder: true,
//             csp: {
//               connectDomains: [],   // No external connect — all data via tool-input/result
//               resourceDomains: [],  // No external resources — single inlined bundle
//               frameDomains: [],
//               baseUriDomains: [],
//             },
//           },
//           // P2a §3.1: render token consumed by the iframe gate.
//           // Present when the orchestrator has a cached render JWT.
//           // Absent in dev mode (AGNTUX_DEV_MODE=1) and when no licence is cached.
//           ...(license ? { license } : {}),
//         },
//       }],
//     };
//   }
//
// _meta.license is read from readRenderTokenFromLicense() at resources/read time —
// NOT from a global. This ensures the freshest available token is always used.
// The token is sourced from ~/.agntux/.license per P2a §4 / P5.AMEND.1.
