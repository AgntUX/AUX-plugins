// =============================================================================
// canvas-ui.tsx — iframe entry for the agntux-slack canvas view.
// =============================================================================

import { createRoot } from "react-dom/client";

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

function CanvasView({ payload }: { payload: CanvasPayloadOk | { error: string } | null }): JSX.Element {
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
let currentPayload: CanvasPayloadOk | { error: string } | null = null;
root.render(<CanvasView payload={currentPayload} />);

window.addEventListener("message", (ev) => {
  const data = ev.data;
  if (data && typeof data === "object" && data.type === "tool-result") {
    currentPayload = data.structuredContent;
    root.render(<CanvasView payload={currentPayload} />);
  }
});
