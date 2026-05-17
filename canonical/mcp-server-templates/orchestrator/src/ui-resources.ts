import { fetchUIBundle, readRenderTokenFromLicense } from "./s3-fetch.js";

const UI_PATHS: Record<string, string> = {
  "ui://triage": "triage/index.html",
  "ui://entity-browser": "entity-browser/index.html",
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

  // Read render token from ~/.agntux/.license per P2a §4.
  // If the file is missing or malformed, returns undefined — the gate fails closed
  // with reason: "missing" (P2a §6.1). Do NOT throw.
  const license = readRenderTokenFromLicense();

  // MCP Apps spec (specification/2026-01-26/apps.mdx):
  //   mimeType MUST be `text/html;profile=mcp-app`; the host BUILDS the CSP
  //   header from `_meta.ui.csp.{connectDomains,resourceDomains,frameDomains,
  //   baseUriDomains}` (already injects 'self' 'unsafe-inline' for the
  //   inlined <script type="module"> bundle). Any other shape — including
  //   the legacy `_meta["openai/widgetCSP"]` string form or a raw
  //   `script_src`/`style_src` object — fails strict hosts with
  //   "Unsupported UI resource content format".
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
