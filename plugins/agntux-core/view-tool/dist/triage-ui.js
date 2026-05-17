import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// =============================================================================
// triage-ui.tsx — iframe entry for the agntux-core triage view.
// Vite (vite-plugin-singlefile) emits one self-contained HTML at
// dist/ui-resources/triage.html.
//
// The shape here matches the structuredContent contract emitted by
// agntux-core-view.ts.
//
// ── MCP Apps protocol ──────────────────────────────────────────────────────
//
// This iframe communicates with the host via JSON-RPC 2.0 over postMessage
// per the MCP Apps spec (`ext-apps/specification/2026-01-26/apps.mdx`).
// The bare `data.type === "tool-result"` listener shape that earlier
// versions of this file used did NOT speak the real protocol — hosts
// (claude.ai, Claude Desktop) send
// `{ jsonrpc: "2.0", method: "ui/notifications/tool-result", params }`
// envelopes, never matched by the bare check, so the iframe stayed on
// "Loading…" forever. 9.5.4 wires the canonical SimpleMcpApp wrapper from
// ./lib/apps-client/ which performs the ui/initialize handshake and
// dispatches notifications to the right handler.
// =============================================================================
import "./globals.css";
import { createRoot } from "react-dom/client";
import { SimpleMcpApp } from "./lib/apps-client/simple-mcp-app.js";
function TriageView({ payload }) {
    if (!payload)
        return _jsx("div", { className: "p-4", children: "Loading\u2026" });
    if ("connect_error" in payload) {
        return (_jsxs("div", { className: "p-4", children: [_jsx("p", { className: "font-semibold", children: "Couldn't reach the host." }), _jsx("p", { className: "text-sm opacity-70 mt-1", children: payload.connect_error }), _jsxs("p", { className: "text-sm mt-2", children: ["Refresh the iframe or re-invoke ", _jsx("code", { children: "/agntux triage-digest" }), "."] })] }));
    }
    if ("error" in payload) {
        return (_jsx("div", { className: "p-4", children: _jsx("p", { children: "No action items yet \u2014 run /agntux onboard to get started." }) }));
    }
    if (payload.bootstrap_mode) {
        return (_jsx("div", { className: "p-4", children: _jsx("p", { children: "Triage is empty. Sync a source plugin to populate items." }) }));
    }
    return (_jsxs("div", { className: "p-4", children: [_jsxs("h1", { className: "text-lg font-semibold", children: ["Triage \u2014 ", payload.counts.open, " open, ", payload.counts.snoozed, " snoozed"] }), _jsx("ul", { className: "mt-2 space-y-2", children: payload.actions.map((a) => (_jsxs("li", { className: "border-b py-2", children: [_jsx("div", { className: "font-medium", children: a.title }), _jsxs("div", { className: "text-sm opacity-70", children: [a.priority, " \u00B7 ", a.reason_class] }), _jsx("p", { className: "text-sm mt-1", children: a.summary })] }, a.id))) }), payload.handled_recent.length > 0 && (_jsxs(_Fragment, { children: [_jsx("h2", { className: "text-base font-semibold mt-4", children: "Recently handled" }), _jsx("ul", { className: "mt-2 space-y-1", children: payload.handled_recent.map((h) => (_jsxs("li", { className: "text-sm", children: [h.title, " ", _jsxs("span", { className: "opacity-50", children: ["\u2014 ", h.handled_at] })] }, h.id))) })] }))] }));
}
const root = createRoot(document.getElementById("root"));
let currentPayload = null;
root.render(_jsx(TriageView, { payload: currentPayload }));
const app = new SimpleMcpApp({
    name: "agntux-core-triage-view",
    version: "1.0.0",
});
// `ontoolresult` fires when the host delivers
// `ui/notifications/tool-result` after the agent's tool call resolves.
// `params.structuredContent` carries the payload the handler emitted.
app.ontoolresult = (params) => {
    const sc = params
        ?.structuredContent;
    currentPayload = (sc ?? null);
    root.render(_jsx(TriageView, { payload: currentPayload }));
};
void app.connect().catch((err) => {
    // 9.5.6: don't leave the iframe stuck on "Loading…" if the host
    // handshake fails. Render an error state with the message so the user
    // knows it's a connect failure (not a slow-loading payload).
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[triage-view] SimpleMcpApp.connect failed:", msg);
    currentPayload = { connect_error: msg };
    root.render(_jsx(TriageView, { payload: currentPayload }));
});
//# sourceMappingURL=triage-ui.js.map