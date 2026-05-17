// =============================================================================
// {{ui-name}}-ui.tsx — the React UI surface for {{ui-display-name}}.
//
// Compiled by Vite (vite-plugin-singlefile) into one self-contained HTML file
// per resource (dist/ui-resources/{{ui-name}}.html). The remote MCP server
// serves the HTML at the resource URI declared on the view-tool descriptor;
// the iframe loads it and listens for structuredContent over postMessage.
//
// ── MCP Apps protocol ──────────────────────────────────────────────────────
//
// Wires the canonical SimpleMcpApp wrapper from ./lib/apps-client/ to
// receive `ui/notifications/tool-result` per the MCP Apps spec
// (`ext-apps/specification/2026-01-26/apps.mdx`). Iframes that listen for
// a bare `data.type === "tool-result"` message will NEVER receive the
// tool result — the host sends a JSON-RPC 2.0 envelope, not a plain event.
// Always use SimpleMcpApp (or apps-react's useToolResult) to receive
// host-to-iframe messages. See agntux-core/CHANGELOG.md → 9.5.4 for the
// bug class this wrapper exists to prevent.
// =============================================================================

import { createRoot } from "react-dom/client";
import { SimpleMcpApp } from "./lib/apps-client/simple-mcp-app.js";

interface {{ui-name-pascal}}Payload {
  action_id: string;
  title: string;
  body: string;
}

type Payload =
  | {{ui-name-pascal}}Payload
  | { error: string }
  | { connect_error: string }
  | null;

function {{ui-name-pascal}}View({ payload }: { payload: Payload }): JSX.Element {
  if (!payload) return <div className="p-4">Loading…</div>;
  if ("connect_error" in payload) {
    return (
      <div className="p-4">
        <p className="font-semibold">Couldn't reach the host.</p>
        <p className="text-sm opacity-70 mt-1">{payload.connect_error}</p>
      </div>
    );
  }
  if ("error" in payload) {
    return <div className="p-4">Error: {payload.error}</div>;
  }
  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold">{payload.title}</h1>
      <pre className="whitespace-pre-wrap mt-2">{payload.body}</pre>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
let currentPayload: Payload = null;
root.render(<{{ui-name-pascal}}View payload={currentPayload} />);

const app = new SimpleMcpApp({
  name: "{{plugin-slug-kebab}}-{{ui-name}}-view",
  version: "1.0.0",
});

app.ontoolresult = (params) => {
  const sc = (params as { structuredContent?: unknown } | undefined)
    ?.structuredContent;
  currentPayload = (sc ?? null) as Payload;
  root.render(<{{ui-name-pascal}}View payload={currentPayload} />);
};

void app.connect().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[{{ui-name}}-view] SimpleMcpApp.connect failed:", msg);
  currentPayload = { connect_error: msg };
  root.render(<{{ui-name-pascal}}View payload={currentPayload} />);
});
