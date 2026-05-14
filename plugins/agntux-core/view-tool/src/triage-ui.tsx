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

interface TriageActionRow {
  id: string;
  title: string;
  summary: string;
  priority: "high" | "medium" | "low";
  status: "open" | "snoozed";
  reason_class: string;
  why_matters_excerpt: string;
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

type TriagePayload = TriagePayloadOk | { error: string } | null;

function TriageView({ payload }: { payload: TriagePayload }): JSX.Element {
  if (!payload) return <div className="p-4">Loading…</div>;
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

window.addEventListener("message", (ev) => {
  const data = ev.data;
  if (data && typeof data === "object" && data.type === "tool-result") {
    currentPayload = data.structuredContent;
    root.render(<TriageView payload={currentPayload} />);
  }
});
