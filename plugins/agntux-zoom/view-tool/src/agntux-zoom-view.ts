// =============================================================================
// agntux-zoom-view — view tool for the Zoom connector plugin.
//
// Exports ONE view tool: agntux_zoom_save_doc_view.
// Runs on the remote MCP server. Receives a ViewToolContext whose `fs` is
// S3-backed (production) or local-fs-backed (plugin-toolkit-test). Returns
// a structuredContent payload the save-doc iframe consumes via postMessage.
//
// ── Render-harness safety ────────────────────────────────────────────────────
// The headless render check invokes this handler with empty args `{}`.
// Guard action_id up front — never build `actions/undefined.md` — and wrap
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

const RESOURCE_URI = "ui://agntux-zoom/save-doc" as const;
const UI_LABEL = "Zoom Doc save";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SaveDocArgs {
  action_id: string;
}

interface SaveDocPayload {
  action_id: string;
  meeting_uuid: string;
  meeting_topic: string;
  meeting_date: string;
  participants: string[];
  meeting_summary: string;
  action_items: string[];
  draft_doc_title: string;
  draft_doc_body: string;
  open_in_zoom_url: string;
  personalization_signals: string[];
}

// ── Safe helpers ──────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// ── Compose-payload section parser ────────────────────────────────────────────

function parseComposePayload(body: string): Record<string, unknown> | null {
  const yamlStr = extractFencedYaml(body, "Compose payload");
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

const EMPTY_PAYLOAD: SaveDocPayload = {
  action_id: "",
  meeting_uuid: "",
  meeting_topic: "",
  meeting_date: "",
  participants: [],
  meeting_summary: "",
  action_items: [],
  draft_doc_title: "",
  draft_doc_body: "",
  open_in_zoom_url: "",
  personalization_signals: [],
};

async function handle(
  args: SaveDocArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: SaveDocPayload;
}> {
  // ── Render-harness contract ─────────────────────────────────────────────────
  // Guard the id up front: never build `actions/undefined.md`.
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

    // Parse participants string[]
    const rawParticipants = cp.participants;
    const participants: string[] = Array.isArray(rawParticipants)
      ? rawParticipants.filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
      : [];

    // Parse action_items string[]
    const rawActionItems = cp.action_items;
    const actionItems: string[] = Array.isArray(rawActionItems)
      ? rawActionItems.filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
      : [];

    // Parse personalization_signals string[]
    const rawSignals = cp.personalization_signals;
    const personalizationSignals: string[] = Array.isArray(rawSignals)
      ? rawSignals.filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
      : [];

    const payload: SaveDocPayload = {
      action_id: actionId,
      meeting_uuid: str(cp.meeting_uuid),
      meeting_topic: str(cp.meeting_topic),
      meeting_date: str(cp.meeting_date),
      participants,
      meeting_summary: str(cp.meeting_summary),
      action_items: actionItems,
      draft_doc_title: str(cp.draft_doc_title),
      draft_doc_body: str(cp.draft_doc_body),
      open_in_zoom_url: str(cp.open_in_zoom_url),
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

const saveDocViewTool: ViewTool<SaveDocArgs, SaveDocPayload> = {
  descriptor: {
    name: "agntux_zoom_save_doc_view",
    description:
      "Use this to save the meeting summary and action items to a Zoom Doc. " +
      "Shown when the user wants to capture Zoom meeting outcomes into a new Zoom Doc from an AgntUX action item. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'open the zoom save-doc composer for action {id}' -> call with {action_id: id}. " +
      "For these click-time prompts, pass ONLY action_id. " +
      "The tool reads the action file's '## Compose payload' body section and lifts " +
      "meeting_uuid, meeting_topic, meeting_date, participants, meeting_summary, " +
      "action_items, draft_doc_title, draft_doc_body, open_in_zoom_url, and " +
      "personalization_signals from disk. " +
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
        meeting_uuid: { type: "string" },
        meeting_topic: { type: "string" },
        meeting_date: { type: "string" },
        participants: { type: "array", items: { type: "string" } },
        meeting_summary: { type: "string" },
        action_items: { type: "array", items: { type: "string" } },
        draft_doc_title: { type: "string" },
        draft_doc_body: { type: "string" },
        open_in_zoom_url: { type: "string" },
        personalization_signals: { type: "array", items: { type: "string" } },
      },
      required: [
        "action_id",
        "meeting_uuid",
        "meeting_topic",
        "meeting_date",
        "participants",
        "meeting_summary",
        "action_items",
        "draft_doc_title",
        "draft_doc_body",
        "open_in_zoom_url",
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

const mod: ViewToolModule = { viewTools: [saveDocViewTool] };
export default mod;
