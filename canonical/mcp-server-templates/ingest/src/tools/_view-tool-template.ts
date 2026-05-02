// =============================================================================
// VIEW TOOL TEMPLATE — {{ui-name}}_view
// =============================================================================
//
// CONSTRAINTS (linter rule T23 will grep tools/*.ts and reject violations):
//
//   NO third-party MCP imports        — import nothing from mcp__<source>__*
//   NO source MCP calls               — do not call any mcp__<source>__* tool
//   NO fs.writeFile / fs.appendFile   — this tool is read-only; zero file writes
//   NO network calls                  — no fetch(), no https.request, no http.get
//   NO state mutation                 — stateless: same inputs → same outputs
//
// The only tools/calls allowed are:
//   - Returning structuredContent + resourceUri + _meta (see return shape below)
//   - Reading <agntux project root>/user.md at call time to apply preference ordering
//     (P5 §7.3 "Personalization" rule — demote noise items to bottom, don't hide)
//
// Naming convention: {verb_root}_view where verb_root matches the view_tool
// declared in the corresponding agents/ui-handlers/{name}.md operational manifest.
// The linter enforces the ^[a-z][a-z0-9_]*_view$ pattern (P9 D2).
//
// =============================================================================

// Tool descriptor — registered via Server.setRequestHandler(ListToolsRequestSchema).
// The generator (P6) substitutes {{ui-name}} and {{plugin-slug}} from the manifest.
export const viewToolDescriptor = {
  name: "{{ui-name}}_view",
  description:
    "Render the {{ui-name}} UI component for {{source-display-name}}. " +
    "Returns structuredContent populated with source data and _meta.ui.resourceUri " +
    "pointing at ui://{{ui-name}}. Stateless: no source MCP calls, no file writes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      // Required: the source-native reference for the item to render.
      // Format hint: see P9 §7.4 for per-source {ref} patterns.
      source_ref: {
        type: "string",
        description: "Source-native reference for the item (e.g., thread_ts, issue key).",
      },
      // Optional orchestrator-authored slots (filled by ux at click time per P9 D1).
      proposed_content: {
        type: "string",
        description: "Orchestrator-authored proposed reply, summary, or draft body. May be empty.",
      },
      highlighted_ids: {
        type: "array",
        items: { type: "string" },
        description: "IDs of source items to visually highlight. May be empty.",
      },
      // Forwarded from the action item for use in follow-up intent templates.
      action_id: {
        type: "string",
        description: "Action item ID from <agntux project root>/actions/. Forwarded into structuredContent.",
      },
    },
    required: ["source_ref"],
  },
} as const;

// StructuredContent shape returned by this view tool.
// The component reads this via useToolResult() and MUST default every field
// defensively (arrays → [], strings → '') because the same envelope is synthesised
// from streaming tool-input-partial notifications before tool-result arrives (P9 §2.6).
interface ViewToolArgs {
  source_ref: string;
  proposed_content?: string;
  highlighted_ids?: string[];
  action_id?: string;
}

interface ViewToolResult {
  structuredContent: {
    // {{structured-content-field-1}}: the primary source data array (e.g., messages, items).
    // Replace with per-source field names when the generator substitutes this template.
    items: Array<Record<string, unknown>>;
    // {{structured-content-field-2}}: secondary data (e.g., members, participants).
    members: Array<Record<string, unknown>>;
    highlighted_ids: string[];
    proposed_content: string;
    action_id: string;
    source_ref: string;
  };
  content: Array<{ type: "text"; text: string }>;
  _meta: {
    ui: {
      resourceUri: string;
      visibility: string[];
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
      resourceUri: string;
      visibility: string[];
    };
  };
}

// Handler — registered via Server.setRequestHandler(CallToolRequestSchema).
// Returns ViewToolResult on success or StructuredErrorResult on source failure.
// NEVER throws — always return a structured result so the host can render a
// graceful error state rather than an unhandled exception.
export async function handleViewTool(
  args: Record<string, unknown>
): Promise<ViewToolResult | StructuredErrorResult> {
  const { source_ref, proposed_content = "", highlighted_ids = [], action_id = "" } =
    args as unknown as ViewToolArgs;

  // Validate source_ref format. If malformed, return structured error.
  // Replace the TODO with per-source format validation (see P9 §7.4).
  if (!source_ref || typeof source_ref !== "string") {
    return structuredError(
      "not_found",
      `{{ui-name}}_view: source_ref is required. Got: ${JSON.stringify(source_ref)}`
    );
  }

  // ---------------------------------------------------------------------------
  // DATA ASSEMBLY — substitute per-source logic here.
  //
  // The view tool does NOT call source MCPs directly. Source data arrives via
  // the tool arguments (the host's agent loop called the source MCP first, then
  // calls this view tool with the results — see P9 §6.2 wire trace).
  //
  // If source data is missing or signals an error, return structuredError(...).
  // ---------------------------------------------------------------------------

  // TODO: extract source data from args (the host passes it from the prior source
  // MCP call). Replace `items` and `members` with per-source field names.
  const items: Array<Record<string, unknown>> = [];
  const members: Array<Record<string, unknown>> = [];

  return {
    structuredContent: {
      items,
      members,
      highlighted_ids: Array.isArray(highlighted_ids) ? highlighted_ids : [],
      proposed_content: typeof proposed_content === "string" ? proposed_content : "",
      action_id: typeof action_id === "string" ? action_id : "",
      source_ref,
    },
    content: [
      {
        type: "text",
        text: `{{source-display-name}} {{ui-name}} — ${source_ref}`,
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

function structuredError(
  kind: "auth_failed" | "not_found" | "network",
  message: string
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
