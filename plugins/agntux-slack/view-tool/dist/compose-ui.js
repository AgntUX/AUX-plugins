import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// =============================================================================
// compose-ui.tsx — iframe entry for the agntux-slack compose view.
// Vite (vite-plugin-singlefile) emits one self-contained HTML at
// dist/ui-resources/compose.html.
// =============================================================================
import { createRoot } from "react-dom/client";
function ComposeView({ payload }) {
    if (!payload)
        return _jsx("div", { className: "p-4", children: "Loading\u2026" });
    if ("error" in payload) {
        return _jsxs("div", { className: "p-4", children: ["Error: ", payload.error] });
    }
    return (_jsxs("div", { className: "p-4", children: [_jsxs("h1", { className: "text-lg font-semibold", children: ["Reply to #", payload.channel.name] }), _jsx("pre", { className: "whitespace-pre-wrap mt-2", children: payload.drafted_body })] }));
}
const root = createRoot(document.getElementById("root"));
// Minimal MCP App UI bridge — listen for tool-result postMessage events.
let currentPayload = null;
root.render(_jsx(ComposeView, { payload: currentPayload }));
window.addEventListener("message", (ev) => {
    const data = ev.data;
    if (data && typeof data === "object" && data.type === "tool-result") {
        currentPayload = data.structuredContent;
        root.render(_jsx(ComposeView, { payload: currentPayload }));
    }
});
//# sourceMappingURL=compose-ui.js.map