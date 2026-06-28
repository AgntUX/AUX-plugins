// =============================================================================
// agntux-apple-notes-view — view tools for the Apple Notes connector plugin.
//
// Exports TWO view tools in a single module:
//   1. agntux_apple_notes_create_note — compose and save a new note
//   2. agntux_apple_notes_update_note — edit an existing note / checklist
//
// Both handlers are action_id-driven. They read the action file from the
// personal action store, extract the relevant data, and return a
// structuredContent payload the iframe consumes.
//
// Render-harness safety: both handlers guard against empty/undefined action_id
// and degrade gracefully to an empty placeholder so cold first-paint and the
// headless render check never produce a tool-call HTTP 500.
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

// ── Constants ────────────────────────────────────────────────────────────────

const CREATE_NOTE_RESOURCE_URI = "ui://agntux-apple-notes/create-note" as const;
const UPDATE_NOTE_RESOURCE_URI = "ui://agntux-apple-notes/update-note" as const;

const UI_LABEL_CREATE = "Apple Notes — Create Note";
const UI_LABEL_UPDATE = "Apple Notes — Update Note";

// ── Create-Note types ─────────────────────────────────────────────────────────

interface CreateNoteArgs {
  action_id: string;
}

interface ChecklistItem {
  text: string;
  checked: boolean;
}

interface CreateNotePayload {
  action_id: string;
  source_context: string;
  draft_title: string;
  draft_body: string;
  target_folder: string;
  available_folders: string[];
}

// ── Update-Note types ─────────────────────────────────────────────────────────

interface UpdateNoteArgs {
  action_id: string;
}

interface UpdateNotePayload {
  action_id: string;
  source_context: string;
  note_name: string;
  note_id: string;
  folder: string;
  current_content: string;
  draft_body: string;
  is_checklist: boolean;
  checklist_items: ChecklistItem[];
}

// ── Safe string helper ───────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ── Compose-payload section parser ───────────────────────────────────────────

/**
 * Read the `## Compose payload` fenced YAML block from the action body and
 * return the parsed object, or null if the section is absent or unparseable.
 *
 * Both create-note and update-note use this section header (per the canonical
 * `compose-payload.md` schema). The section is an H2 in the action body
 * containing a single fenced ```yaml block authored by the ingest skill.
 */
function parseComposeSectionYaml(body: string): Record<string, unknown> | null {
  // Read this plugin's OWN payload. On a sibling's action file the cross-source
  // merge writes our data under the namespaced `## Compose payload (apple-notes)`
  // header — read it FIRST so we get our data, not the sibling's bare
  // `## Compose payload`. On our own freshly-raised action only the bare header
  // exists, so the `??` falls through. (E37 / agntux-google-calendar 0.7.1.)
  const yamlStr =
    extractFencedYaml(body, "Compose payload (apple-notes)") ??
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

// ── Handler: create-note ─────────────────────────────────────────────────────

async function handleCreateNote(
  args: CreateNoteArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: CreateNotePayload;
}> {
  const emptyPayload: CreateNotePayload = {
    action_id: "",
    source_context: "",
    draft_title: "",
    draft_body: "",
    target_folder: "Notes",
    available_folders: ["Notes"],
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_CREATE) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");

    // Resolve: read the `## Compose payload` body section (primary).
    // The ingest skill writes all compose-side fields there as fenced YAML.
    // The standard ActionFrontmatter fields (id, status, priority, etc.) are
    // in the `---` block and are NOT the source of compose payload data.
    const { body } = parseFrontmatter(text);
    const cp = parseComposeSectionYaml(body);

    if (!cp) {
      // Section absent or malformed — degrade to empty placeholder so the
      // render harness doesn't produce a 500, but surface the gap via
      // action_id so the iframe's compose_payload_missing path fires.
      return {
        content: [{ type: "text", text: renderConfirmationText(UI_LABEL_CREATE) }],
        structuredContent: { ...emptyPayload, action_id: actionId },
      };
    }

    const payload: CreateNotePayload = {
      action_id: actionId,
      source_context: str(cp.source_context),
      draft_title: str(cp.draft_title),
      draft_body: str(cp.draft_body),
      target_folder: str(cp.target_folder) || "Notes",
      available_folders: strArr(cp.available_folders).length > 0
        ? strArr(cp.available_folders)
        : ["Notes"],
    };

    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_CREATE) }],
      structuredContent: payload,
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_CREATE) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

// ── Handler: update-note ─────────────────────────────────────────────────────

function parseChecklist(content: string): ChecklistItem[] {
  // Apple Notes checklist lines use the pattern:
  //   - [ ] unchecked item
  //   - [x] checked item
  // We also handle plain "- item" lines as unchecked for resilience.
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line): ChecklistItem | null => {
      const checkedMatch = /^[-*]\s+\[x\]\s+(.+)$/i.exec(line.trim());
      if (checkedMatch) return { text: checkedMatch[1].trim(), checked: true };
      const uncheckedMatch = /^[-*]\s+\[\s\]\s+(.+)$/.exec(line.trim());
      if (uncheckedMatch) return { text: uncheckedMatch[1].trim(), checked: false };
      // Plain dash lines treated as unchecked items
      const plainMatch = /^[-*]\s+(.+)$/.exec(line.trim());
      if (plainMatch) return { text: plainMatch[1].trim(), checked: false };
      return null;
    })
    .filter((item): item is ChecklistItem => item !== null);
}

async function handleUpdateNote(
  args: UpdateNoteArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: UpdateNotePayload;
}> {
  const emptyPayload: UpdateNotePayload = {
    action_id: "",
    source_context: "",
    note_name: "",
    note_id: "",
    folder: "",
    current_content: "",
    draft_body: "",
    is_checklist: false,
    checklist_items: [],
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_UPDATE) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");

    // Resolve: read the `## Compose payload` body section (primary).
    // The ingest skill writes note_name, note_id, folder, current_content,
    // draft_body, is_checklist, and checklist_items into this section as
    // fenced YAML, NOT into the standard ActionFrontmatter block.
    const { body } = parseFrontmatter(text);
    const cp = parseComposeSectionYaml(body);

    if (!cp) {
      return {
        content: [{ type: "text", text: renderConfirmationText(UI_LABEL_UPDATE) }],
        structuredContent: { ...emptyPayload, action_id: actionId },
      };
    }

    const isChecklist = cp.is_checklist === true;
    const currentContent = str(cp.current_content);
    const rawItems = cp.checklist_items;

    let checklistItems: ChecklistItem[] = [];
    if (isChecklist) {
      if (Array.isArray(rawItems)) {
        // Parse from structured payload array authored by ingest
        checklistItems = rawItems
          .map((item): ChecklistItem | null => {
            if (!item || typeof item !== "object") return null;
            const r = item as Record<string, unknown>;
            return {
              text: str(r.text),
              checked: r.checked === true,
            };
          })
          .filter((item): item is ChecklistItem => item !== null && item.text.length > 0);
      }
      // Fallback: parse checklist markers from the raw current_content string
      if (checklistItems.length === 0 && currentContent) {
        checklistItems = parseChecklist(currentContent);
      }
    }

    const payload: UpdateNotePayload = {
      action_id: actionId,
      source_context: str(cp.source_context),
      note_name: str(cp.note_name),
      note_id: str(cp.note_id),
      folder: str(cp.folder),
      current_content: currentContent,
      draft_body: str(cp.draft_body) || currentContent,
      is_checklist: isChecklist,
      checklist_items: checklistItems,
    };

    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_UPDATE) }],
      structuredContent: payload,
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_UPDATE) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

// ── Descriptors ───────────────────────────────────────────────────────────────

const createNoteViewTool: ViewTool<CreateNoteArgs, CreateNotePayload> = {
  descriptor: {
    name: "agntux_apple_notes_create_note",
    description:
      "Use this to compose and save a new note to Apple Notes. Shown when the user wants to create a note from an AgntUX action item or from context. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'open the create-note composer for action {id}' → call with {action_id: id}. " +
      "For these click-time prompts, pass ONLY action_id. " +
      "The tool reads the action file's '## Compose payload' body section and lifts " +
      "draft_title, draft_body, target_folder, available_folders, and source_context from disk. " +
      "Do NOT pass draft_title, draft_body, target_folder, available_folders, or source_context inline — " +
      "those fields are not accepted as inline args and any attempt to supply them will be ignored; " +
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
        source_context: { type: "string" },
        draft_title: { type: "string" },
        draft_body: { type: "string" },
        target_folder: { type: "string" },
        available_folders: { type: "array", items: { type: "string" } },
      },
      required: [
        "action_id",
        "source_context",
        "draft_title",
        "draft_body",
        "target_folder",
        "available_folders",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: CREATE_NOTE_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleCreateNote,
};

const updateNoteViewTool: ViewTool<UpdateNoteArgs, UpdateNotePayload> = {
  descriptor: {
    name: "agntux_apple_notes_update_note",
    description:
      "Use this to edit an existing Apple Notes note — update its body, add content, or check off checklist items. Shown when the user wants to update a note from an AgntUX action item. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'open the update-note composer for action {id}' → call with {action_id: id}. " +
      "For these click-time prompts, pass ONLY action_id. " +
      "The tool reads the action file's '## Compose payload' body section and lifts " +
      "note_name, note_id, folder, current_content, draft_body, is_checklist, checklist_items, " +
      "and source_context from disk. " +
      "Do NOT pass note_name, note_id, folder, current_content, draft_body, is_checklist, " +
      "checklist_items, or source_context inline — those fields are not accepted as inline args " +
      "and any attempt to supply them will be ignored; " +
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
        source_context: { type: "string" },
        note_name: { type: "string" },
        note_id: { type: "string" },
        folder: { type: "string" },
        current_content: { type: "string" },
        draft_body: { type: "string" },
        is_checklist: { type: "boolean" },
        checklist_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              checked: { type: "boolean" },
            },
            required: ["text", "checked"],
          },
        },
      },
      required: [
        "action_id",
        "source_context",
        "note_name",
        "note_id",
        "folder",
        "current_content",
        "draft_body",
        "is_checklist",
        "checklist_items",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: UPDATE_NOTE_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleUpdateNote,
};

// ── Default export ────────────────────────────────────────────────────────────

const mod: ViewToolModule = {
  viewTools: [createNoteViewTool, updateNoteViewTool],
};
export default mod;
