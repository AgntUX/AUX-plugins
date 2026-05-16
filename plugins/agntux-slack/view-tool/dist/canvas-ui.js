import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// =============================================================================
// canvas-ui.tsx — iframe entry for the agntux-slack canvas view.
// =============================================================================
import { createRoot } from "react-dom/client";
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
window.addEventListener("message", (ev) => {
    const data = ev.data;
    if (data && typeof data === "object" && data.type === "tool-result") {
        currentPayload = data.structuredContent;
        root.render(_jsx(CanvasView, { payload: currentPayload }));
    }
});
//# sourceMappingURL=canvas-ui.js.map