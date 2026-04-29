import { fetchUIBundle, readRenderTokenFromLicense } from "./s3-fetch.js";
import { buildCSP } from "./csp.js";

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

  const csp = buildCSP();

  // Read render token from ~/.agntux/.license per P2a §4.
  // If the file is missing or malformed, returns undefined — the gate fails closed
  // with reason: "missing" (P2a §6.1). Do NOT throw.
  const license = readRenderTokenFromLicense();

  return {
    contents: [
      {
        uri,
        mimeType: "text/html",
        text: html,
        _meta: {
          "openai/widgetCSP": csp,
          ...(license ? { license } : {}),
        },
      },
    ],
  };
}
