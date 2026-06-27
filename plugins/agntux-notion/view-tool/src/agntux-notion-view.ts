// =============================================================================
// agntux-notion-view.ts — view tool module for the Notion MCP App.
//
// Runs on the remote MCP server. Returns structuredContent objects consumed
// by their respective iframes via the postMessage protocol.
//
// Three handlers: comment (reply-to-comment), update (update-page), create
// (create-page). Each returns a lean payload that the iframe binds to JSX.
// =============================================================================

import {
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  extractFrontmatterMetadata,
  parseFrontmatter,
  renderConfirmationText,
} from "@agntux/plugin-runtime";

// Safe string extractor for unknown values.
function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// ── Handler 1: Comment (reply to a comment on the page) ─────────────────────

const COMMENT_RESOURCE_URI = "ui://agntux-notion/reply-comment" as const;
const COMMENT_UI_LABEL = "Notion comment reply";

interface CommentArgs {
  action_id: string;
}

interface CommentPayload {
  action_id: string;
  page_id: string;
  discussion_id: string;
  page_url: string;
  page_title: string;
  comment_thread: string;
  draft_body: string;
  personalization_signals: string;
}

async function handleComment(
  args: CommentArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: CommentPayload;
}> {
  const emptyPayload: CommentPayload = {
    action_id: "",
    page_id: "",
    discussion_id: "",
    page_url: "",
    page_title: "",
    comment_thread: "",
    draft_body: "",
    personalization_signals: "",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(COMMENT_UI_LABEL) }],
      structuredContent: emptyPayload,
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    // extractFrontmatterMetadata returns the raw parsed YAML object so
    // plugin-specific fields (page_id, discussion_id, etc.) not part of the
    // canonical ActionFrontmatter shape are accessible. parseFrontmatter
    // normalises only the agntux-core ActionFrontmatter keys and discards
    // all other YAML fields, so it cannot be used for plugin-specific keys.
    const fm: Record<string, unknown> =
      extractFrontmatterMetadata(buf.toString("utf8")) ?? {};
    return {
      content: [{ type: "text", text: renderConfirmationText(COMMENT_UI_LABEL) }],
      structuredContent: {
        action_id: actionId,
        // page_id and discussion_id are written to frontmatter by the ingest
        // skill. page_id is the Notion page UUID; discussion_id is the
        // Notion comment-thread UUID (distinct from page_id). The component
        // passes these verbatim to buildEnvelope so the Notion Connector can
        // target the correct discussion thread. Falls back to action_id only
        // as a last resort — this produces a degraded envelope but avoids a
        // hard failure when the ingest skill has not yet written these keys.
        page_id: s(fm.page_id) || actionId,
        discussion_id: s(fm.discussion_id),
        page_url: s(fm.page_url),
        page_title: s(fm.title) || s(fm.page_title),
        comment_thread: s(fm.comment_thread),
        draft_body: s(fm.draft_body),
        personalization_signals: s(fm.personalization_signals),
      },
    };
  } catch {
    // Any failure (missing file, parse error, fs error) degrades to empty payload.
    // Never rethrow — a thrown error surfaces as HTTP 500 to the iframe.
    return {
      content: [{ type: "text", text: renderConfirmationText(COMMENT_UI_LABEL) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

const commentViewTool: ViewTool<CommentArgs, CommentPayload> = {
  descriptor: {
    name: "agntux_notion_comment_view",
    description:
      "Use this to show a Notion comment-reply composer when the user needs to reply to a comment thread on a Notion page. " +
      "Displays the quoted comment thread above an editable reply field so the user can draft and post their response. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'open the comment reply composer for action {id}' → call with {action_id: id}; " +
      "'use the agntux-notion plugin to open the comment reply composer for action {id}' → call with {action_id: id}. " +
      "For these click-time prompts, pass ONLY action_id. The tool reads the action file and lifts " +
      "page_title, comment_thread, draft_body, and personalization_signals from disk. " +
      "Do NOT pass page_url, comment_thread, draft_body, or personalization_signals inline — " +
      "any inline value (including partial or empty objects) overrides the on-disk payload destructively, " +
      "producing an empty UI.",
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
        page_id: { type: "string" },
        discussion_id: { type: "string" },
        page_url: { type: "string" },
        page_title: { type: "string" },
        comment_thread: { type: "string" },
        draft_body: { type: "string" },
        personalization_signals: { type: "string" },
      },
      required: ["action_id", "page_id", "discussion_id", "page_url", "page_title", "comment_thread", "draft_body", "personalization_signals"],
      additionalProperties: false,
    },
    ui_resource_uri: COMMENT_RESOURCE_URI,
    data_paths: [
      { pattern: "actions/{id}.md", scope: "personal" },
    ],
  },
  handle: handleComment,
};

// ── Handler 2: Update (update the page's properties) ────────────────────────

const UPDATE_RESOURCE_URI = "ui://agntux-notion/update-page" as const;
const UPDATE_UI_LABEL = "Notion page property editor";

interface UpdateArgs {
  action_id: string;
}

interface UpdatePayload {
  action_id: string;
  page_id: string;
  page_url: string;
  page_title: string;
  current_properties: string;
  editable_properties: string;
}

async function handleUpdate(
  args: UpdateArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: UpdatePayload;
}> {
  const emptyPayload: UpdatePayload = {
    action_id: "",
    page_id: "",
    page_url: "",
    page_title: "",
    current_properties: "",
    editable_properties: "",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UPDATE_UI_LABEL) }],
      structuredContent: emptyPayload,
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    // extractFrontmatterMetadata returns the raw parsed YAML object so
    // plugin-specific fields (page_id, page_url, etc.) not part of the
    // canonical ActionFrontmatter shape are accessible.
    const fm: Record<string, unknown> =
      extractFrontmatterMetadata(buf.toString("utf8")) ?? {};
    return {
      content: [{ type: "text", text: renderConfirmationText(UPDATE_UI_LABEL) }],
      structuredContent: {
        action_id: actionId,
        // page_id is the Notion page UUID written to frontmatter by the ingest
        // skill. It is the target of notion-update-page. Falls back to
        // action_id only as a last resort for ingest-skill compat during rollout.
        page_id: s(fm.page_id) || actionId,
        page_url: s(fm.page_url),
        page_title: s(fm.title) || s(fm.page_title),
        current_properties: s(fm.current_properties),
        editable_properties: s(fm.editable_properties),
      },
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UPDATE_UI_LABEL) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

const updateViewTool: ViewTool<UpdateArgs, UpdatePayload> = {
  descriptor: {
    name: "agntux_notion_update_view",
    description:
      "Use this to show a Notion page property editor when the user needs to update status, due date, or other properties on a Notion page. " +
      "Displays current property values and lets the user edit them before saving. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'update page properties for action {id}' → call with {action_id: id}; " +
      "'use the agntux-notion plugin to update page properties for action {id}' → call with {action_id: id}. " +
      "For these click-time prompts, pass ONLY action_id. The tool reads the action file and lifts " +
      "page_title, current_properties, and editable_properties from disk. " +
      "Do NOT pass page_url, current_properties, or editable_properties inline — " +
      "any inline value (including partial or empty objects) overrides the on-disk payload destructively, " +
      "producing an empty UI.",
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
        page_id: { type: "string" },
        page_url: { type: "string" },
        page_title: { type: "string" },
        current_properties: { type: "string" },
        editable_properties: { type: "string" },
      },
      required: ["action_id", "page_id", "page_url", "page_title", "current_properties", "editable_properties"],
      additionalProperties: false,
    },
    ui_resource_uri: UPDATE_RESOURCE_URI,
    data_paths: [
      { pattern: "actions/{id}.md", scope: "personal" },
    ],
  },
  handle: handleUpdate,
};

// ── Handler 3: Create (create a new page) ───────────────────────────────────

const CREATE_RESOURCE_URI = "ui://agntux-notion/create-page" as const;
const CREATE_UI_LABEL = "Notion new page creator";

interface CreateArgs {
  action_id: string;
}

interface CreatePayload {
  action_id: string;
  parent_options: string;
  draft_title: string;
  draft_body: string;
}

async function handleCreate(
  args: CreateArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: CreatePayload;
}> {
  const emptyPayload: CreatePayload = {
    action_id: "",
    parent_options: "",
    draft_title: "",
    draft_body: "",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(CREATE_UI_LABEL) }],
      structuredContent: emptyPayload,
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    // extractFrontmatterMetadata returns the raw parsed YAML object so
    // plugin-specific fields (parent_options, draft_title) are accessible.
    // parseFrontmatter is used only to extract the markdown body below the
    // frontmatter delimiter — it correctly splits the file even though its
    // returned frontmatter object normalises only the canonical fields.
    const fm: Record<string, unknown> = extractFrontmatterMetadata(text) ?? {};
    const { body } = parseFrontmatter(text);
    return {
      content: [{ type: "text", text: renderConfirmationText(CREATE_UI_LABEL) }],
      structuredContent: {
        action_id: actionId,
        parent_options: s(fm.parent_options),
        draft_title: s(fm.draft_title) || s(fm.title),
        draft_body: body ?? "",
      },
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(CREATE_UI_LABEL) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

const createViewTool: ViewTool<CreateArgs, CreatePayload> = {
  descriptor: {
    name: "agntux_notion_create_view",
    description:
      "Use this to show a Notion new-page creator when the user needs to create a new page in their Notion workspace. " +
      "Lets the user choose a parent location, edit the page title, and write the initial body before creating it. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'open the page creator for action {id}' → call with {action_id: id}; " +
      "'use the agntux-notion plugin to create a page for action {id}' → call with {action_id: id}. " +
      "For these click-time prompts, pass ONLY action_id. The tool reads the action file and lifts " +
      "parent_options, draft_title, and draft_body from disk. " +
      "Do NOT pass parent_options, draft_title, or draft_body inline — " +
      "any inline value (including partial or empty objects) overrides the on-disk payload destructively, " +
      "producing an empty UI.",
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
        parent_options: { type: "string" },
        draft_title: { type: "string" },
        draft_body: { type: "string" },
      },
      required: ["action_id", "parent_options", "draft_title", "draft_body"],
      additionalProperties: false,
    },
    ui_resource_uri: CREATE_RESOURCE_URI,
    data_paths: [
      { pattern: "actions/{id}.md", scope: "personal" },
    ],
  },
  handle: handleCreate,
};

// ── Default export ───────────────────────────────────────────────────────────

const mod: ViewToolModule = {
  viewTools: [commentViewTool, updateViewTool, createViewTool],
};
export default mod;
