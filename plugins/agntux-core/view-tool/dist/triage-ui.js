import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// =============================================================================
// triage-ui.tsx — iframe entry for the agntux-core triage view.
// Vite (vite-plugin-singlefile) emits one self-contained HTML at
// dist/ui-resources/triage.html.
//
// Minimal MVP shell — full primitives (ScrollablePanel, ServerErrorScreen,
// safe-accessors, suggested-actions buttons) will move out of the legacy
// ui-handlers/triage/component/ subtree in a follow-up pass. The shape here
// matches the structuredContent contract emitted by agntux-core-view.ts.
// =============================================================================
import { createRoot } from "react-dom/client";
function TriageView({ payload }) {
    if (!payload)
        return _jsx("div", { className: "p-4", children: "Loading\u2026" });
    if ("error" in payload) {
        return (_jsx("div", { className: "p-4", children: _jsx("p", { children: "No action items yet \u2014 run /agntux onboard to get started." }) }));
    }
    if (payload.bootstrap_mode) {
        return (_jsx("div", { className: "p-4", children: _jsx("p", { children: "Triage is empty. Sync a source plugin to populate items." }) }));
    }
    return (_jsxs("div", { className: "p-4", children: [_jsxs("h1", { className: "text-lg font-semibold", children: ["Triage \u2014 ", payload.counts.open, " open, ", payload.counts.snoozed, " snoozed"] }), _jsx("ul", { className: "mt-2 space-y-2", children: payload.actions.map((a) => (_jsxs("li", { className: "border-b py-2", children: [_jsx("div", { className: "font-medium", children: a.title }), _jsxs("div", { className: "text-sm opacity-70", children: [a.priority, " \u00B7 ", a.reason_class] }), _jsx("p", { className: "text-sm mt-1", children: a.summary })] }, a.id))) }), payload.handled_recent.length > 0 && (_jsxs(_Fragment, { children: [_jsx("h2", { className: "text-md font-semibold mt-4", children: "Recently handled" }), _jsx("ul", { className: "mt-2 space-y-1", children: payload.handled_recent.map((h) => (_jsxs("li", { className: "text-sm", children: [h.title, " ", _jsxs("span", { className: "opacity-50", children: ["\u2014 ", h.handled_at] })] }, h.id))) })] }))] }));
}
const root = createRoot(document.getElementById("root"));
let currentPayload = null;
root.render(_jsx(TriageView, { payload: currentPayload }));
window.addEventListener("message", (ev) => {
    const data = ev.data;
    if (data && typeof data === "object" && data.type === "tool-result") {
        currentPayload = data.structuredContent;
        root.render(_jsx(TriageView, { payload: currentPayload }));
    }
});
//# sourceMappingURL=triage-ui.js.map