// =============================================================================
// ui-resources.ts — serves the UI bundle for `ui://triage` from the
// build-time-embedded base64 string. No S3, no signed URLs, no on-disk cache.
//
// The embed pipeline:
//   1. component/ builds via Vite into component/out/index.html (single-file).
//   2. mcp-server's `tsc` step emits dist/ui-resources/triage.js with the
//      `__EMBED__triage__INDEX_HTML__` placeholder still present.
//   3. scripts/embed-bundle.mjs walks dist/ and substitutes the placeholder
//      with the base64 of component/out/index.html.
//   4. scripts/check-bundle-sync.mjs is the CI guard that re-runs the embed
//      check and fails the build if the embed is stale.
//
// At runtime the host calls `resources/read` with the URI; we look it up in
// `UI_BUNDLES`, decode, attach `_meta.ui.csp` + `_meta.license`, and return.
// Errors are STRUCTURED (per P2a §4) — we never throw from this path so the
// host can render a graceful failure rather than an unhandled exception.
// =============================================================================
import { buildCSP } from "./csp.js";
import { triageBundleBase64Placeholder, triageBundleDescriptor, TRIAGE_RESOURCE_URI, } from "./ui-resources/triage.js";
const UI_BUNDLES = {
    [TRIAGE_RESOURCE_URI]: {
        uri: triageBundleDescriptor.uri,
        mimeType: triageBundleDescriptor.mimeType,
        base64: triageBundleBase64Placeholder,
    },
};
export async function handleUIResource(uri) {
    const bundle = UI_BUNDLES[uri];
    if (!bundle) {
        return {
            isError: true,
            contents: [{ type: "text", text: `Unknown UI resource: ${uri}` }],
        };
    }
    // Decode the embedded base64. If the embed step has never run, the
    // "base64" string is the literal placeholder; decoding it produces garbage,
    // and the iframe will fail to render. Detect that case and return a
    // structured error rather than letting the iframe render gibberish.
    if (bundle.base64.startsWith("__EMBED__")) {
        return {
            isError: true,
            contents: [
                {
                    type: "text",
                    text: `UI bundle for ${uri} is not embedded. Build the component ` +
                        `(npm run build in ui-handlers/triage/component/) and rebuild ` +
                        `the MCP server (npm run build in mcp-server/).`,
                },
            ],
        };
    }
    let html;
    try {
        html = Buffer.from(bundle.base64, "base64").toString("utf8");
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            isError: true,
            contents: [
                {
                    type: "text",
                    text: `Failed to decode UI bundle for ${uri}: ${message}`,
                },
            ],
        };
    }
    const csp = buildCSP();
    return {
        contents: [
            {
                uri,
                mimeType: bundle.mimeType,
                text: html,
                _meta: {
                    "openai/widgetCSP": csp,
                    ui: {
                        prefersBorder: true,
                        csp: {
                            connectDomains: [],
                            resourceDomains: ["data:", "blob:"],
                            frameDomains: [],
                            baseUriDomains: [],
                        },
                    },
                },
            },
        ],
    };
}
// Exported for tests + ListResources handler in index.ts.
export const UI_RESOURCE_LIST = Object.values(UI_BUNDLES).map((b) => ({
    uri: b.uri,
    name: "Action item triage view",
    mimeType: b.mimeType,
}));
