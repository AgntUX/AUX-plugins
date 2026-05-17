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

interface CanvasPayloadOk {
  action_id: string;
  channel: { id: string; name: string };
  drafted_canvas: {
    title: string;
    tldr: string;
    decisions: string[];
    open_questions: string[];
  };
}

type CanvasPayload = CanvasPayloadOk | { error: string } | null;

function CanvasView({ payload }: { payload: CanvasPayload }): JSX.Element {
  if (!payload) return <div className="p-4">Loading…</div>;
  if ("error" in payload) {
    return <div className="p-4">Error: {payload.error}</div>;
  }
  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold">{payload.drafted_canvas.title}</h1>
      <p className="mt-2">{payload.drafted_canvas.tldr}</p>
      <h2 className="mt-4 font-semibold">Decisions</h2>
      <ul className="list-disc pl-5">
        {payload.drafted_canvas.decisions.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
      <h2 className="mt-4 font-semibold">Open questions</h2>
      <ul className="list-disc pl-5">
        {payload.drafted_canvas.open_questions.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ul>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
let currentPayload: CanvasPayload = null;
root.render(<CanvasView payload={currentPayload} />);

const app = new SimpleMcpApp({
  name: "agntux-slack-canvas-view",
  version: "1.0.0",
});

app.ontoolresult = (params) => {
  const sc = (params as { structuredContent?: unknown } | undefined)
    ?.structuredContent;
  currentPayload = (sc ?? null) as CanvasPayload;
  root.render(<CanvasView payload={currentPayload} />);
};

void app.connect().catch((err: unknown) => {
  console.error("[canvas-view] SimpleMcpApp.connect failed:", err);
});
