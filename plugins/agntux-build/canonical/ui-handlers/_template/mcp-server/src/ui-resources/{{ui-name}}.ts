// =============================================================================
// FRAGMENT — merge into the plugin's mcp-server/src/ui-resources.ts at
// scaffolder substitution time.
//
// Distribution model: GIT-NATIVE BUILD-TIME EMBED.
// The component's `dist/index.html` (produced by `npm run build` in
// component/) is inlined as a base64 string into the compiled MCP server JS
// at build time via the embed plugin in scripts/embed-bundle.mjs (added by
// the scaffolder). Zero S3 dependency, zero runtime filesystem reads.
//
// How to wire in:
//
//   In the target plugin's ui-resources.ts, add the bundle entry below to
//   the UI_BUNDLES map and merge the resource handler. The build-time embed
//   replaces the EMBED_PLACEHOLDER token with the real base64 bundle:
//
//     // Generated at build time — see scripts/embed-bundle.mjs
//     const {{ui-name-camel}}BundleBase64 = "__EMBED__{{ui-name}}__INDEX_HTML__";
//
//     export const {{ui-name-camel}}Bundle: UiBundle = {
//       uri: "ui://{{ui-name}}",
//       mimeType: "text/html;profile=mcp-app",
//       getHtml: () => Buffer.from({{ui-name-camel}}BundleBase64, "base64").toString("utf8"),
//     };
//
// =============================================================================

// Bundle descriptor — one per UI component this handler ships.
//
// The placeholder string is replaced at build time by the bundle's base64
// contents. The CI sync-check at scripts/check-bundle-sync.mjs fails the
// build if dist/index.html and the placeholder substitution drift apart.
export const {{ui-name-camel}}BundleBase64Placeholder =
  "__EMBED__{{ui-name}}__INDEX_HTML__";

// UI bundle descriptor — the MCP server's `handleUIResource` reads from this
// when the host requests `resources/read` on the bundle's URI.
export const {{ui-name-camel}}BundleDescriptor = {
  uri: "ui://{{ui-name}}",
  mimeType: "text/html;profile=mcp-app" as const,
  // The compiled JS loads `{{ui-name-camel}}Bundle` (assigned at build time
  // from `{{ui-name-camel}}BundleBase64Placeholder` after embed). The
  // descriptor here only declares the URI + MIME type so other modules can
  // assemble the URI map without importing the (potentially large) bundle.
} as const;

// Resource handler shape — merged into the plugin's `handleUIResource` function.
// _meta.ui.csp restricts what the iframe can connect to; for plugins that ship
// a single inlined bundle and pass all data through tool-input/result, the
// connect/resource/frame/baseUri lists are intentionally empty.
//
// _meta.license is read from `readRenderTokenFromLicense()` at resources/read
// time — NOT from a global. This ensures the freshest available token is
// always used. The token is sourced from ~/.agntux/.license. The dev-toolkit
// scaffolder leaves this hook in place; in dev mode (AGNTUX_DEV_MODE=1) the
// token is absent and the field is omitted.
//
// Reference shape — the scaffolder owns the actual file:
//
//   import { readRenderTokenFromLicense } from "./license.js";
//   import {
//     {{ui-name-camel}}BundleDescriptor,
//     {{ui-name-camel}}BundleBase64Placeholder,
//   } from "./ui-resources/{{ui-name}}.js";
//
//   const UI_BUNDLES = {
//     [{{ui-name-camel}}BundleDescriptor.uri]: {
//       descriptor: {{ui-name-camel}}BundleDescriptor,
//       base64: {{ui-name-camel}}BundleBase64Placeholder,
//     },
//     // ... other UI bundles merged in by the scaffolder
//   };
//
//   export async function handleUIResource(uri: string) {
//     const entry = UI_BUNDLES[uri];
//     if (!entry) {
//       return { isError: true, contents: [{ type: "text", text: `Unknown UI resource: ${uri}` }] };
//     }
//     const html = Buffer.from(entry.base64, "base64").toString("utf8");
//     const license = readRenderTokenFromLicense();
//     return {
//       contents: [{
//         uri,
//         mimeType: entry.descriptor.mimeType,
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
//           // Render token consumed by the iframe gate. Present when the
//           // orchestrator has a cached render JWT; absent in dev mode.
//           ...(license ? { license } : {}),
//         },
//       }],
//     };
//   }
