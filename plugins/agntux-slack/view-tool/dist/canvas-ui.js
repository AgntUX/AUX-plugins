import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// =============================================================================
// canvas-ui.tsx — iframe entry for the agntux-slack canvas view.
//
// ── MCP Apps protocol ──────────────────────────────────────────────────────
//
// Wires the canonical SimpleMcpApp wrapper from ./lib/apps-client/ to
// receive `ui/notifications/tool-result` per the MCP Apps spec. The bare
// `data.type === "tool-result"` listener that earlier versions of this
// file used never matched the host's JSON-RPC envelope. See
// agntux-core/CHANGELOG.md → 9.5.4 for the bug-class rationale.
// =============================================================================
import { createRoot } from "react-dom/client";
import { SimpleMcpApp } from "./lib/apps-client/simple-mcp-app.js";
function CanvasView({ payload }) {
    if (!payload)
        return _jsx("div", { className: "p-4", children: "Loading\u2026" });
    if ("error" in payload) {
        return _jsxs("div", { className: "p-4", children: ["Error: ", payload.error] });
    }
    return (_jsxs("div", { className: "p-4", children: [_jsx("h1", { className: "text-lg font-semibold", children: payload.drafted_canvas.title }), _jsx("p", { className: "mt-2", children: payload.drafted_canvas.tldr }), _jsx("h2", { className: "mt-4 font-semibold", children: "Decisions" }), _jsx("ul", { className: "list-disc pl-5", children: payload.drafted_canvas.decisions.map((d, i) => (_jsx("li", { children: d }, i))) }), _jsx("h2", { className: "mt-4 font-semibold", children: "Open questions" }), _jsx("ul", { className: "list-disc pl-5", children: payload.drafted_canvas.open_questions.map((q, i) => (_jsx("li", { children: q }, i))) })] }));
}
const root = createRoot(document.getElementById("root"));
let currentPayload = null;
root.render(_jsx(CanvasView, { payload: currentPayload }));
const app = new SimpleMcpApp({
    name: "agntux-slack-canvas-view",
    version: "1.0.0",
});
app.ontoolresult = (params) => {
    const sc = params
        ?.structuredContent;
    currentPayload = (sc ?? null);
    root.render(_jsx(CanvasView, { payload: currentPayload }));
};
void app.connect().catch((err) => {
    console.error("[canvas-view] SimpleMcpApp.connect failed:", err);
});
//# sourceMappingURL=canvas-ui.js.map