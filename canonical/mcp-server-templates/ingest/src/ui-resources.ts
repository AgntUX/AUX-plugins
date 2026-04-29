import { fetchUIBundle, readRenderTokenFromLicense } from "./s3-fetch.js";
// csp.ts exports buildCSP() for the string-form CSP header (openai/widgetCSP).
// This module uses the structured ui.csp object shape from P9 §2.5 instead.
// Import buildCSP() here if you need the string form for a non-MCP-App resource.

// UI_PATHS maps ui:// URIs to the S3-relative paths for this plugin's UI bundles.
// The generator (P6) substitutes one entry per UI component the plugin ships.
// Example for slack-ingest:
//   "ui://thread": "thread/index.html",
//   "ui://channel-summary": "channel-summary/index.html",
//
// Plugins with no UI components (e.g., notes-ingest) do not include this file.
const UI_PATHS: Record<string, string> = {
  // {{ui-resource-entries}}
  // Expanded by P6 generator to one entry per UI component:
  //   "ui://{{ui-name}}": "{{ui-name}}/index.html",
};

interface ResourceContents {
  uri: string;
  mimeType: string;
  text: string;
  _meta: Record<string, unknown>;
}

interface ResourceResponse {
  contents: ResourceContents[];
}

interface StructuredError {
  isError: true;
  contents: Array<{ type: "text"; text: string }>;
}

export async function handleUIResource(uri: string): Promise<ResourceResponse | StructuredError> {
  const path = UI_PATHS[uri];
  if (!path) {
    // Structured error per P2a §4 — do NOT throw for unknown URIs.
    return {
      isError: true,
      contents: [{ type: "text", text: `Unknown UI resource: ${uri}` }],
    };
  }

  let html: string;
  try {
    html = await fetchUIBundle(path);
  } catch (err) {
    // Structured error per P2a §4 — do NOT throw for fetch failures.
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      contents: [{ type: "text", text: `Failed to fetch UI bundle for ${uri}: ${message}` }],
    };
  }

  // Read render token from ~/.agntux/.license per P2a §4 / P5.AMEND.1.
  // Source plugins read the same ~/.agntux/.license cache as the orchestrator;
  // they do not maintain their own (P5 §7.4). If the file is missing or malformed,
  // returns undefined — the gate fails closed with reason: "missing" (P2a §6.1).
  // Do NOT throw.
  const license = readRenderTokenFromLicense();

  return {
    contents: [
      {
        uri,
        mimeType: "text/html;profile=mcp-app",
        text: html,
        _meta: {
          ui: {
            prefersBorder: true,
            csp: {
              connectDomains: [],
              resourceDomains: [],
              frameDomains: [],
              baseUriDomains: [],
            },
          },
          ...(license ? { license } : {}),
        },
      },
    ],
  };
}

// Exported for use by tests and index.ts resource listing.
export const UI_RESOURCE_URIS: readonly string[] = Object.keys(UI_PATHS);
