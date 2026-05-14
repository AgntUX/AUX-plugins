// =============================================================================
// compose-ui.tsx — iframe entry for the agntux-gmail compose view.
// =============================================================================

import { createRoot } from "react-dom/client";

interface ComposePayloadOk {
  action_id: string;
  thread: { subject: string };
  drafted_body: string;
}

function ComposeView({ payload }: { payload: ComposePayloadOk | { error: string } | null }): JSX.Element {
  if (!payload) return <div className="p-4">Loading…</div>;
  if ("error" in payload) {
    return <div className="p-4">Error: {payload.error}</div>;
  }
  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold">{payload.thread.subject}</h1>
      <pre className="whitespace-pre-wrap mt-2">{payload.drafted_body}</pre>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
let currentPayload: ComposePayloadOk | { error: string } | null = null;
root.render(<ComposeView payload={currentPayload} />);

window.addEventListener("message", (ev) => {
  const data = ev.data;
  if (data && typeof data === "object" && data.type === "tool-result") {
    currentPayload = data.structuredContent;
    root.render(<ComposeView payload={currentPayload} />);
  }
});
