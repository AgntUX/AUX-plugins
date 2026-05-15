// =============================================================================
// {{view-tool-name}} — view tool for the {{ui-display-name}} MCP App.
//
// Runs on the remote MCP server in app/. Receives a ViewToolContext whose
// `fs` is S3-backed (in production) or local-fs-backed (in plugin-toolkit-test
// render-view-tool, the developer iteration loop). Returns a structuredContent
// object the iframe consumes via the postMessage protocol.
//
// Multi-tool shape: this file exports an ARRAY of viewTools. Single-view
// plugins (like this template) export a one-element array; multi-view plugins
// (e.g. agntux-slack with compose + canvas) export N elements. The compiled
// module's `default.viewTools` is the contract the remote registry consumes.
// =============================================================================

import {
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  ViewToolFsError,
  parseActionFile,
} from "@agntux/plugin-runtime";

// ── Constants & caps ─────────────────────────────────────────────────────────

const RESOURCE_URI = "ui://{{plugin-slug-kebab}}/{{ui-name}}" as const;

// ── Types ────────────────────────────────────────────────────────────────────

interface {{ui-name-pascal}}Args {
  action_id: string;
}

interface {{ui-name-pascal}}Payload {
  // Shape matches the structuredContent schema pinned in §2 of
  // ui-handler-author.md. Narrow it deliberately.
  action_id: string;
  title: string;
  body: string;
}

// ── Handler ──────────────────────────────────────────────────────────────────

async function handle(
  args: {{ui-name-pascal}}Args,
  ctx: ViewToolContext,
): Promise<{ structuredContent: {{ui-name-pascal}}Payload }> {
  const path = `actions/${args.action_id}.md`;
  try {
    const buf = await ctx.fs.readFile(path);
    const parsed = parseActionFile(buf.toString("utf8"));
    return {
      structuredContent: {
        action_id: args.action_id,
        title: (parsed.frontmatter.title as string | undefined) ?? "",
        body: parsed.body ?? "",
      },
    };
  } catch (err) {
    if (err instanceof ViewToolFsError && err.code === "not-found") {
      return {
        structuredContent: {
          action_id: args.action_id,
          title: "",
          body: "",
        },
      };
    }
    throw err;
  }
}

// ── Descriptor ──────────────────────────────────────────────────────────────

const viewTool: ViewTool<{{ui-name-pascal}}Args, {{ui-name-pascal}}Payload> = {
  descriptor: {
    name: "{{view-tool-name}}",
    description: "{{view-tool-description}}",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["action_id", "title", "body"],
      additionalProperties: false,
    },
    ui_resource_uri: RESOURCE_URI,
  },
  handle,
};

// ── Default export (the contract Phase 3's materialize.ts consumes) ─────────

const mod: ViewToolModule = { viewTools: [viewTool] };
export default mod;
