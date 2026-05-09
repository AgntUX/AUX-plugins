// =============================================================================
// {{view-tool-name}} — stateless view tool for the {{ui-display-name}} UI handler
// =============================================================================
//
// CONSTRAINTS (linter rules grep tools/*.ts and reject violations):
//
//   NO third-party MCP imports        — import nothing from mcp__{{source-mcp-prefix}}__*
//   NO source MCP calls               — do not call any mcp__{{source-mcp-prefix}}__* tool
//   NO fs.writeFile / fs.appendFile   — this tool is read-only; zero file writes
//   NO network calls                  — no fetch(), no https.request, no http.get
//   NO state mutation                 — stateless: same inputs → same outputs
//
// Source data arrives via tool arguments. The host's agent loop calls the
// source MCP first (e.g., mcp__{{source-mcp-prefix}}__*), then calls this view
// tool with the results. This tool only packages args into the structuredContent
// envelope and returns _meta.ui.resourceUri so the host renders the right MCP App.
//
// Naming: {{view-tool-name}} — matches ^[a-z][a-z0-9_]*_view$.
// Registered via Server.setRequestHandler(ListToolsRequestSchema) in index.ts.
// =============================================================================

// Tool descriptor — registered via Server.setRequestHandler(ListToolsRequestSchema).
export const viewToolDescriptor = {
  name: "{{view-tool-name}}",
  description:
    "Render the {{ui-name}} UI component for {{source-display}}. " +
    "Returns structuredContent populated with {{primary-payload-fields}}. " +
    "Also returns _meta.ui.resourceUri pointing at ui://{{ui-name}}. " +
    "Stateless: no source MCP calls, no file writes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      // ── Replace with the concrete fields the host relays for this UI. ──────
      //
      // For each field:
      //   - keep the type narrow (string, number, boolean, array, object)
      //   - include a description that names the source MCP call the host
      //     used to obtain it (e.g., "from mcp__slack__get_thread")
      //   - mark required slots in `required: [...]` below
      //
      // Defensive normalisation happens in the handler — see `handle{{ui-name-pascal}}View`.
      // ──────────────────────────────────────────────────────────────────────
      {{primary-id-field}}: {
        type: "string",
        description: "Primary source identifier. Required.",
      },
      // EXAMPLE — replace these with real fields:
      // payload_items: {
      //   type: "array",
      //   items: {
      //     type: "object",
      //     properties: {
      //       id:   { type: "string" },
      //       text: { type: "string" },
      //     },
      //   },
      //   description: "Array of items rendered in the component body.",
      // },
      // action_id: {
      //   type: "string",
      //   description: "Forwarded into structuredContent for follow-up intents.",
      // },
    },
    required: ["{{primary-id-field}}"],
  },
} as const;

// ── Types ────────────────────────────────────────────────────────────────────
//
// Define the concrete shape of structuredContent here. Every field on the
// `{{ui-name-pascal}}StructuredContent` interface MUST be assigned by the
// handler — defensive defaults make this safe even when the host omits the
// field. See briefing-learnings.md §1.1–1.2 for the normalisation pattern.
// ─────────────────────────────────────────────────────────────────────────────

interface ViewToolArgs {
  {{primary-id-field}}: string;
  // Add the rest of the fields declared in `inputSchema` above (all optional —
  // the handler defends against absence).
}

export interface {{ui-name-pascal}}StructuredContent {
  {{primary-id-field}}: string;
  // Add the concrete output shape — every field gets a default in the handler
  // so the component never sees `undefined`.
}

interface ViewToolResult {
  structuredContent: {{ui-name-pascal}}StructuredContent;
  content: Array<{ type: "text"; text: string }>;
  _meta: {
    ui: {
      resourceUri: "ui://{{ui-name}}";
      visibility: ["model", "app"];
    };
  };
}

interface StructuredErrorResult {
  structuredContent: {
    error: "auth_failed" | "not_found" | "network";
  };
  content: Array<{ type: "text"; text: string }>;
  _meta: {
    ui: {
      resourceUri: "ui://{{ui-name}}";
      visibility: ["model", "app"];
    };
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

// Handler — registered via Server.setRequestHandler(CallToolRequestSchema).
// Returns ViewToolResult on success or StructuredErrorResult on source failure.
// NEVER throws — always return a structured result so the host can render a
// graceful error state rather than an unhandled exception.
export async function handle{{ui-name-pascal}}View(
  args: Record<string, unknown>,
): Promise<ViewToolResult | StructuredErrorResult> {
  const { {{primary-id-field}} } = args as unknown as ViewToolArgs;

  // Validate the primary id — required, must be a non-empty string.
  if (
    !{{primary-id-field}} ||
    typeof {{primary-id-field}} !== "string" ||
    {{primary-id-field}}.trim() === ""
  ) {
    return structuredError(
      "not_found",
      "{{view-tool-name}}: {{primary-id-field}} is required. Got: " +
        JSON.stringify({{primary-id-field}}),
    );
  }

  // Validate id format if a regex applies (uncomment + adapt):
  // const ID_RE = /^[a-z0-9-]+$/i;
  // if (!ID_RE.test({{primary-id-field}}.trim())) {
  //   return structuredError(
  //     "not_found",
  //     `{{view-tool-name}}: {{primary-id-field}} "${ {{primary-id-field}} }" is not valid.`,
  //   );
  // }

  // Defensive normalisation — every field defaults so the component never
  // receives undefined. See briefing-learnings.md §1.1–1.2.
  // Add normalisation per field declared in inputSchema, e.g.:
  //
  //   const safeItems = Array.isArray(items)
  //     ? items.map((m) => ({
  //         id:   typeof m.id   === "string" ? m.id   : "",
  //         text: typeof m.text === "string" ? m.text : "",
  //       }))
  //     : [];

  return {
    structuredContent: {
      {{primary-id-field}}: {{primary-id-field}}.trim(),
      // ...spread the defensive-defaulted fields here
    },
    content: [
      {
        type: "text",
        text: `{{ui-display-name}} ${ {{primary-id-field}} } rendered.`,
      },
    ],
    _meta: {
      ui: {
        resourceUri: "ui://{{ui-name}}",
        visibility: ["model", "app"],
      },
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function structuredError(
  kind: "auth_failed" | "not_found" | "network",
  message: string,
): StructuredErrorResult {
  return {
    structuredContent: { error: kind },
    content: [{ type: "text", text: message }],
    _meta: {
      ui: {
        resourceUri: "ui://{{ui-name}}",
        visibility: ["model", "app"],
      },
    },
  };
}
