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
//
// ── Payload-shape rule ──────────────────────────────────────────────────────
//
// `structuredContent` is the JSON-RPC body the host returns to the chat
// model — capped at ~64 KB. Only ship fields the iframe actually binds to
// JSX. Build a row → grep your iframe for every field name on it → drop
// anything that's not bound. The bug class is silent: a saturated workspace
// (long thread, 30+ rows, max-length excerpts) inflates the wire body past
// the cap, the host rejects the result, the iframe never renders, and you
// only find out from a user report. See plugins/agntux-core/CHANGELOG.md →
// 9.5.3 for the canonical incident; this template ships a regression-guard
// test at `__tests__/payload-shape.test.ts` that enforces a byte budget +
// a frozen key set so the bug becomes structurally hard to ship.
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
    // Convention (agntux-build _template, P15 §UI tool descriptor suffix):
    // every UI-rendering tool description ends with the standard
    // stop-after-rendering directive so the host's model doesn't add
    // commentary or chain follow-up tool calls. Author {{view-tool-description}}
    // as the verb-phrase / trigger-list body; the suffix is appended here so
    // authors don't have to remember (and can't accidentally double-up).
    description:
      "{{view-tool-description}} " +
      "Once this UI is rendered, the user sees everything they need in the " +
      "iframe — do NOT add any chat commentary after rendering, and do NOT " +
      "make any further tool calls; the UI is the response.",
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
