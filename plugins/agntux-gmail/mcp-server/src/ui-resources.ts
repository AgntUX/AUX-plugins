// =============================================================================
// ui-resources.ts — serves the UI bundle for `ui://gmail-compose` from
// build-time-embedded base64 strings. No S3, no signed URLs, no on-disk cache.
// =============================================================================

import {
  composeBundleBase64Placeholder,
  gmailComposeBundleDescriptor,
  COMPOSE_RESOURCE_URI,
} from "./ui-resources/compose.js";

interface UiBundle {
  uri: string;
  mimeType: string;
  base64: string;
  displayName: string;
}

const UI_BUNDLES: Record<string, UiBundle> = {
  [COMPOSE_RESOURCE_URI]: {
    uri: gmailComposeBundleDescriptor.uri,
    mimeType: gmailComposeBundleDescriptor.mimeType,
    base64: composeBundleBase64Placeholder,
    displayName: "Gmail reply compose view",
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
              resourceDomains: ["data:", "blob:"],
              frameDomains: [],
              baseUriDomains: [],
            },
          },
        },
      },
    ],
  };
}

export const UI_RESOURCE_LIST = Object.values(UI_BUNDLES).map((b) => ({
  uri: b.uri,
  name: b.displayName,
  mimeType: b.mimeType,
}));
