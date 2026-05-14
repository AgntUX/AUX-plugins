// =============================================================================
// compose-ui.tsx — iframe entry for the agntux-slack compose view.
// Vite (vite-plugin-singlefile) emits one self-contained HTML at
// dist/ui-resources/compose.html.
// =============================================================================

import { createRoot } from "react-dom/client";

interface ComposePayloadOk {
  action_id: string;
  channel: { id: string; name: string; is_dm: boolean };
  drafted_body: string;
}

function ComposeView({ payload }: { payload: ComposePayloadOk | { error: string } | null }): JSX.Element {
  if (!payload) return <div className="p-4">Loading…</div>;
  if ("error" in payload) {
    return <div className="p-4">Error: {payload.error}</div>;
  }
  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold">
        Reply to #{payload.channel.name}
      </h1>
      <pre className="whitespace-pre-wrap mt-2">{payload.drafted_body}</pre>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);

// Minimal MCP App UI bridge — listen for tool-result postMessage events.
let currentPayload: ComposePayloadOk | { error: string } | null = null;
root.render(<ComposeView payload={currentPayload} />);

window.addEventListener("message", (ev) => {
  const data = ev.data;
  if (data && typeof data === "object" && data.type === "tool-result") {
    currentPayload = data.structuredContent;
    root.render(<ComposeView payload={currentPayload} />);
  }
});
