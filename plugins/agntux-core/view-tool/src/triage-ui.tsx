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

import { createRoot } from "react-dom/client";
import { SimpleMcpApp } from "./lib/apps-client/simple-mcp-app.js";

interface TriageActionRow {
  id: string;
  title: string;
  summary: string;
  priority: "high" | "medium" | "low";
  status: "open" | "snoozed";
  reason_class: string;
}

interface TriagePayloadOk {
  actions: TriageActionRow[];
  handled_recent: Array<{ id: string; title: string; handled_at: string }>;
  counts: {
    open: number;
    snoozed: number;
    handled_recent: number;
    truncated: boolean;
  };
  last_updated_at: string;
  bootstrap_mode: boolean;
}

type TriagePayload =
  | TriagePayloadOk
  | { error: string }
  | { connect_error: string }
  | null;

function TriageView({ payload }: { payload: TriagePayload }): JSX.Element {
  if (!payload) return <div className="p-4">Loading…</div>;
  if ("connect_error" in payload) {
    return (
      <div className="p-4">
        <p className="font-semibold">Couldn't reach the host.</p>
        <p className="text-sm opacity-70 mt-1">{payload.connect_error}</p>
        <p className="text-sm mt-2">
          Refresh the iframe or re-invoke <code>/agntux triage-digest</code>.
        </p>
      </div>
    );
  }
  if ("error" in payload) {
    return (
      <div className="p-4">
        <p>No action items yet — run /agntux onboard to get started.</p>
      </div>
    );
  }
  if (payload.bootstrap_mode) {
    return (
      <div className="p-4">
        <p>Triage is empty. Sync a source plugin to populate items.</p>
      </div>
    );
  }
  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold">
        Triage — {payload.counts.open} open, {payload.counts.snoozed} snoozed
      </h1>
      <ul className="mt-2 space-y-2">
        {payload.actions.map((a) => (
          <li key={a.id} className="border-b py-2">
            <div className="font-medium">{a.title}</div>
            <div className="text-sm opacity-70">
              {a.priority} · {a.reason_class}
            </div>
            <p className="text-sm mt-1">{a.summary}</p>
          </li>
        ))}
      </ul>
      {payload.handled_recent.length > 0 && (
        <>
          <h2 className="text-md font-semibold mt-4">Recently handled</h2>
          <ul className="mt-2 space-y-1">
            {payload.handled_recent.map((h) => (
              <li key={h.id} className="text-sm">
                {h.title}{" "}
                <span className="opacity-50">— {h.handled_at}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
let currentPayload: TriagePayload = null;
root.render(<TriageView payload={currentPayload} />);

const app = new SimpleMcpApp({
  name: "agntux-core-triage-view",
  version: "1.0.0",
});

// `ontoolresult` fires when the host delivers
// `ui/notifications/tool-result` after the agent's tool call resolves.
// `params.structuredContent` carries the payload the handler emitted.
app.ontoolresult = (params) => {
  const sc = (params as { structuredContent?: unknown } | undefined)
    ?.structuredContent;
  currentPayload = (sc ?? null) as TriagePayload;
  root.render(<TriageView payload={currentPayload} />);
};

void app.connect().catch((err: unknown) => {
  // 9.5.6: don't leave the iframe stuck on "Loading…" if the host
  // handshake fails. Render an error state with the message so the user
  // knows it's a connect failure (not a slow-loading payload).
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[triage-view] SimpleMcpApp.connect failed:", msg);
  currentPayload = { connect_error: msg };
  root.render(<TriageView payload={currentPayload} />);
});
