import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// =============================================================================
// compose-ui.tsx — iframe entry for the agntux-slack compose view.
// Vite (vite-plugin-singlefile) emits one self-contained HTML at
// dist/ui-resources/compose.html.
//
// ── MCP Apps protocol ──────────────────────────────────────────────────────
//
// Wires the canonical SimpleMcpApp wrapper from ./lib/apps-client/ to
// receive `ui/notifications/tool-result` per the MCP Apps spec. The bare
// `data.type === "tool-result"` listener that earlier versions of this
// file used never matched the host's JSON-RPC envelope, so the iframe
// stayed on "Loading…" forever. See agntux-core/CHANGELOG.md → 9.5.4 for
// the bug-class rationale; same fix applied here.
// =============================================================================
import { createRoot } from "react-dom/client";
import { SimpleMcpApp } from "./lib/apps-client/simple-mcp-app.js";
function ComposeView({ payload }) {
    if (!payload)
        return _jsx("div", { className: "p-4", children: "Loading\u2026" });
    if ("error" in payload) {
        return _jsxs("div", { className: "p-4", children: ["Error: ", payload.error] });
    }
    return (_jsxs("div", { className: "p-4", children: [_jsxs("h1", { className: "text-lg font-semibold", children: ["Reply to #", payload.channel.name] }), _jsx("pre", { className: "whitespace-pre-wrap mt-2", children: payload.drafted_body })] }));
}
const root = createRoot(document.getElementById("root"));
let currentPayload = null;
root.render(_jsx(ComposeView, { payload: currentPayload }));
const app = new SimpleMcpApp({
    name: "agntux-slack-compose-view",
    version: "1.0.0",
});
app.ontoolresult = (params) => {
    const sc = params
        ?.structuredContent;
    currentPayload = (sc ?? null);
    root.render(_jsx(ComposeView, { payload: currentPayload }));
};
void app.connect().catch((err) => {
    console.error("[compose-view] SimpleMcpApp.connect failed:", err);
});
//# sourceMappingURL=compose-ui.js.map