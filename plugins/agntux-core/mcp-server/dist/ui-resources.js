// =============================================================================
// ui-resources.ts — local-mcp-server-side UI resource registry.
//
// P5 view-only shape: triage_view moved to `view-tool/dist/agntux-core-view.js`
// and its UI bundle is served by the remote MCP server registry from the
// view-tool's emitted manifest. The local stdio mcp-server (this file) no
// longer ships any UI bundles — the surviving local tools (snooze, dismiss,
// set-status, save_triage_prefs, set_triage_pref) are pure mutators.
//
// The handler is kept as a structured-error stub so the host gets a clean
// "no UI resources here" response if anything still hits this surface.
// =============================================================================
export async function handleUIResource(uri) {
    return {
        isError: true,
        contents: [
            {
                type: "text",
                text: `Unknown UI resource: ${uri}. P5 view-only shape: the agntux-core ` +
                    `local MCP server no longer serves UI bundles. Triage UI is served ` +
                    `by the remote registry from view-tool/dist/ui-resources/triage.html.`,
            },
        ],
    };
}
// Exported for ListResources handler in index.ts. The local mcp-server
// advertises ZERO UI resources under the view-only shape.
export const UI_RESOURCE_LIST = [];
