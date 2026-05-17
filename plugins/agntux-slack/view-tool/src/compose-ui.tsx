// =============================================================================
// compose-ui.tsx — iframe entry for the agntux-slack compose view.
// Vite (vite-plugin-singlefile) emits one self-contained HTML at
// dist/ui-resources/compose.html.
//
// ── MCP Apps protocol ──────────────────────────────────────────────────────
//
// Wires the canonical SimpleMcpApp wrapper from ./lib/apps-client/ to
// receive `ui/notifications/tool-result` per the MCP Apps spec. The bare
// `data.type === "tool-result"` listener that earlier versions of this
// file used never matched the host's JSON-RPC envelope, so the iframe
// stayed on "Loading…" forever. See agntux-core/CHANGELOG.md → 9.5.4 for
// the bug-class rationale; same fix applied here.
// =============================================================================

import { createRoot } from "react-dom/client";
import { SimpleMcpApp } from "./lib/apps-client/simple-mcp-app.js";

interface ComposePayloadOk {
  action_id: string;
  channel: { id: string; name: string; is_dm: boolean };
  drafted_body: string;
}

type ComposePayload = ComposePayloadOk | { error: string } | null;

function ComposeView({ payload }: { payload: ComposePayload }): JSX.Element {
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
let currentPayload: ComposePayload = null;
root.render(<ComposeView payload={currentPayload} />);

const app = new SimpleMcpApp({
  name: "agntux-slack-compose-view",
  version: "1.0.0",
});

app.ontoolresult = (params) => {
  const sc = (params as { structuredContent?: unknown } | undefined)
    ?.structuredContent;
  currentPayload = (sc ?? null) as ComposePayload;
  root.render(<ComposeView payload={currentPayload} />);
};

void app.connect().catch((err: unknown) => {
  console.error("[compose-view] SimpleMcpApp.connect failed:", err);
});
