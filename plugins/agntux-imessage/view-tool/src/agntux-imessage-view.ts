// =============================================================================
// agntux-imessage-view — view tool for the iMessage connector plugin.
//
// Exports ONE view tool: agntux_imessage_reply_view.
// Runs on the remote MCP server. Receives a ViewToolContext whose `fs` is
// S3-backed (production) or local-fs-backed (plugin-toolkit-test). Returns
// a structuredContent payload the reply iframe consumes via postMessage.
//
// ── Render-harness safety ────────────────────────────────────────────────────
// The headless render check invokes this handler with empty args `{}`.
// guard action_id up front — never build `actions/undefined.md` — and wrap
// all fs read + parse in a catch-all that degrades to the placeholder shape.
// =============================================================================

import {
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  parseFrontmatter,
  extractFencedYaml,
  renderConfirmationText,
} from "@agntux/plugin-runtime";
import { load as parseYaml } from "js-yaml";

// ── Constants ─────────────────────────────────────────────────────────────────

const RESOURCE_URI = "ui://agntux-imessage/reply" as const;
const UI_LABEL = "iMessage reply";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReplyArgs {
  action_id: string;
}

interface QuotedMessage {
  content: string;
  date: string;
  is_from_me: boolean;
}

interface ReplyPayload {
  action_id: string;
  contact_name: string;
  contact_handle: string;
  quoted_messages: QuotedMessage[];
  draft_body: string;
  personalization_signals: string[];
}

// ── Safe helpers ──────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// ── Compose-payload section parser ────────────────────────────────────────────

function parseComposePayload(body: string): Record<string, unknown> | null {
  // Read this plugin's OWN payload. On a sibling's action file the cross-source
  // merge writes our data under the namespaced `## Compose payload (imessage)`
  // header — read it FIRST so we get our data, not the sibling's bare
  // `## Compose payload`. On our own freshly-raised action only the bare header
  // exists, so the `??` falls through. (E37 / agntux-google-calendar 0.7.1.)
  const yamlStr =
    extractFencedYaml(body, "Compose payload (imessage)") ??
    extractFencedYaml(body, "Compose payload");
  if (!yamlStr) return null;
  try {
    const parsed = parseYaml(yamlStr);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

const EMPTY_PAYLOAD: ReplyPayload = {
  action_id: "",
  contact_name: "",
  contact_handle: "",
  quoted_messages: [],
  draft_body: "",
  personalization_signals: [],
};

async function handle(
  args: ReplyArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ReplyPayload;
}> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL) }],
      structuredContent: EMPTY_PAYLOAD,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);
    const cp = parseComposePayload(body);

    if (!cp) {
      return {
        content: [{ type: "text", text: renderConfirmationText(UI_LABEL) }],
        structuredContent: { ...EMPTY_PAYLOAD, action_id: actionId },
      };
    }

    // Parse quoted_messages array
    const rawMessages = cp.quoted_messages;
    const quotedMessages: QuotedMessage[] = Array.isArray(rawMessages)
      ? rawMessages
          .map((m): QuotedMessage | null => {
            if (!m || typeof m !== "object") return null;
            const r = m as Record<string, unknown>;
            const msg: QuotedMessage = {
              content: str(r.content),
              date: str(r.date),
              is_from_me: r.is_from_me === true,
            };
            return msg.content ? msg : null;
          })
          .filter((m): m is QuotedMessage => m !== null)
      : [];

    // Parse personalization_signals string[]
    const rawSignals = cp.personalization_signals;
    const personalizationSignals: string[] = Array.isArray(rawSignals)
      ? rawSignals.filter((s): s is string => typeof s === "string" && s.length > 0)
      : [];

    const payload: ReplyPayload = {
      action_id: actionId,
      contact_name: str(cp.contact_name),
      contact_handle: str(cp.contact_handle),
      quoted_messages: quotedMessages,
      draft_body: str(cp.draft_body),
      personalization_signals: personalizationSignals,
    };

    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL) }],
      structuredContent: payload,
    };
  } catch {
    // Any failure — missing action file, fs error, parse error — degrades to
    // the placeholder. Do NOT narrow on ViewToolFsError; errors can cross the
    // render-harness boundary as plain Error instances.
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL) }],
      structuredContent: { ...EMPTY_PAYLOAD, action_id: actionId },
    };
  }
}

// ── Descriptor ────────────────────────────────────────────────────────────────

const replyViewTool: ViewTool<ReplyArgs, ReplyPayload> = {
  descriptor: {
    name: "agntux_imessage_reply_view",
    description:
      "Use this to compose and send a reply to an iMessage. Shown when the user wants to reply to an incoming iMessage from an AgntUX action item. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'open the imessage reply composer for action {id}' → call with {action_id: id}. " +
      "For these click-time prompts, pass ONLY action_id. " +
      "The tool reads the action file's '## Compose payload' body section and lifts " +
      "contact_name, contact_handle, quoted_messages, draft_body, and personalization_signals from disk. " +
      "Do NOT pass those fields inline — they are not accepted as inline args; " +
      "the on-disk payload is always the source of truth for this action-item-triggered view.",
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
        contact_name: { type: "string" },
        contact_handle: { type: "string" },
        quoted_messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              date: { type: "string" },
              is_from_me: { type: "boolean" },
            },
            required: ["content", "date", "is_from_me"],
          },
        },
        draft_body: { type: "string" },
        personalization_signals: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "action_id",
        "contact_name",
        "contact_handle",
        "quoted_messages",
        "draft_body",
        "personalization_signals",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle,
};

// ── Default export ────────────────────────────────────────────────────────────

const mod: ViewToolModule = { viewTools: [replyViewTool] };
export default mod;
