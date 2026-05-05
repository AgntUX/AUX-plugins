// =============================================================================
// ui-resources.ts — serves the UI bundles for `ui://slack-compose` and
// `ui://slack-canvas` from build-time-embedded base64 strings.
// No S3, no signed URLs, no on-disk cache.
//
// The embed pipeline:
//   1. component/ builds via Vite into component/out/index.html (single-file).
//   2. mcp-server's `tsc` step emits dist/ui-resources/{compose,canvas}.js
//      with the `__EMBED__slack-{compose,canvas}__INDEX_HTML__` placeholders.
//   3. scripts/embed-bundle.mjs walks dist/ and substitutes the placeholders
//      with the base64 of each component/out/index.html.
//   4. scripts/check-bundle-sync.mjs is the CI guard.
//
// At runtime the host calls `resources/read` with the URI; we look it up in
// `UI_BUNDLES`, decode, and return with CSP metadata.
// Errors are STRUCTURED — we never throw from this path.
// =============================================================================

import {
  composeBundleBase64Placeholder,
  slackComposeBundleDescriptor,
  COMPOSE_RESOURCE_URI,
} from "./ui-resources/compose.js";
import {
  canvasBundleBase64Placeholder,
  slackCanvasBundleDescriptor,
  CANVAS_RESOURCE_URI,
} from "./ui-resources/canvas.js";

interface UiBundle {
  uri: string;
  mimeType: string;
  base64: string;
  displayName: string;
}

const UI_BUNDLES: Record<string, UiBundle> = {
  [COMPOSE_RESOURCE_URI]: {
    uri: slackComposeBundleDescriptor.uri,
    mimeType: slackComposeBundleDescriptor.mimeType,
    base64: composeBundleBase64Placeholder,
    displayName: "Slack reply compose view",
  },
  [CANVAS_RESOURCE_URI]: {
    uri: slackCanvasBundleDescriptor.uri,
    mimeType: slackCanvasBundleDescriptor.mimeType,
    base64: canvasBundleBase64Placeholder,
    displayName: "Slack canvas summary view",
  },
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

export async function handleUIResource(
  uri: string,
): Promise<ResourceResponse | StructuredError> {
  const bundle = UI_BUNDLES[uri];
  if (!bundle) {
    return {
      isError: true,
      contents: [{ type: "text", text: `Unknown UI resource: ${uri}` }],
    };
  }

  // Detect unembed case: the embed step has never run.
  if (bundle.base64.startsWith("__EMBED__")) {
    const uiName = uri.replace("ui://", "");
    return {
      isError: true,
      contents: [
        {
          type: "text",
          text:
            `UI bundle for ${uri} is not embedded. Build the component ` +
            `(npm run build in ui-handlers/${uiName}/component/) and rebuild ` +
            `the MCP server (npm run build in mcp-server/).`,
        },
      ],
    };
  }

  let html: string;
  try {
    html = Buffer.from(bundle.base64, "base64").toString("utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      contents: [
        {
          type: "text",
          text: `Failed to decode UI bundle for ${uri}: ${message}`,
        },
      ],
    };
  }

  return {
    contents: [
      {
        uri,
        mimeType: bundle.mimeType,
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
        },
      },
    ],
  };
}

// Exported for tests + ListResources handler in index.ts.
export const UI_RESOURCE_LIST = Object.values(UI_BUNDLES).map((b) => ({
  uri: b.uri,
  name: b.displayName,
  mimeType: b.mimeType,
}));
