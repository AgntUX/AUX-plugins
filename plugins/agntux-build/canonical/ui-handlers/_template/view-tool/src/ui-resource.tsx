// =============================================================================
// ui-resource.tsx — the React UI surface for {{ui-display-name}}.
//
// Compiled by Vite (vite-plugin-singlefile) into one self-contained HTML file
// per resource (dist/ui-resources/{{ui-name}}.html). The remote MCP server
// serves the HTML at the resource URI declared on the view-tool descriptor;
// the iframe loads it and listens for structuredContent over postMessage.
//
// Imports apps-client/apps-react via path-relative paths into the SIBLING
// component/ subtree (sub-plan 4 carve-out: those MIT-inlined hooks stay in
// the iframe bundle, NOT in @agntux/plugin-runtime).
// =============================================================================

import { useToolResult } from "../../component/src/lib/apps-react";

interface {{ui-name-pascal}}Payload {
  action_id: string;
  title: string;
  body: string;
}

export function {{ui-name-pascal}}View(): JSX.Element {
  const result = useToolResult<{{ui-name-pascal}}Payload>();
  if (!result) return <div className="p-4">Loading…</div>;
  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold">{result.title}</h1>
      <pre className="whitespace-pre-wrap">{result.body}</pre>
    </div>
  );
}
