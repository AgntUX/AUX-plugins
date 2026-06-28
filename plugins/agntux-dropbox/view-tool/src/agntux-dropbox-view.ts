// =============================================================================
// agntux-dropbox-view — view tools for the Dropbox connector plugin.
//
// Exports FOUR view tools in a single module:
//   1. agntux_dropbox_share        — create a shareable link for a file
//   2. agntux_dropbox_organize     — move or copy a file/folder
//   3. agntux_dropbox_new_folder   — create a new folder
//   4. agntux_dropbox_file_request — set up a file upload request
//
// All handlers are action_id-driven. They read the action file from the
// personal action store, extract the relevant data, and return a
// structuredContent payload the iframe consumes.
//
// Render-harness safety: all handlers guard against empty/undefined action_id
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

const SHARE_RESOURCE_URI        = "ui://agntux-dropbox/share-file"    as const;
const ORGANIZE_RESOURCE_URI     = "ui://agntux-dropbox/organize-file" as const;
const NEW_FOLDER_RESOURCE_URI   = "ui://agntux-dropbox/new-folder"    as const;
const FILE_REQUEST_RESOURCE_URI = "ui://agntux-dropbox/file-request"  as const;

const LABEL_SHARE        = "Dropbox — Share";
const LABEL_ORGANIZE     = "Dropbox — Organize";
const LABEL_NEW_FOLDER   = "Dropbox — New Folder";
const LABEL_FILE_REQUEST = "Dropbox — File Request";

// ── Safe helpers ─────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// ── Compose-payload section parser ───────────────────────────────────────────

function parseComposeSectionYaml(body: string): Record<string, unknown> | null {
  // Read this plugin's OWN payload. On a sibling's action file the cross-source
  // merge writes our data under the namespaced `## Compose payload (dropbox)`
  // header — read it FIRST so we get our data, not the sibling's bare
  // `## Compose payload`. On our own freshly-raised action only the bare header
  // exists, so the `??` falls through. (E37 / agntux-google-calendar 0.7.1.)
  const yamlStr =
    extractFencedYaml(body, "Compose payload (dropbox)") ??
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

// ── Handler 1: share ─────────────────────────────────────────────────────────

interface ShareArgs {
  action_id: string;
}

interface SharePayload {
  action_id: string;
  source_context: string;
  file_path: string;
  file_name: string;
  file_type: string;
  existing_link: string;
  suggested_access: string;
  suggested_expiry: string;
}

async function handleShare(
  args: ShareArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: SharePayload;
}> {
  const emptyPayload: SharePayload = {
    action_id: "",
    source_context: "",
    file_path: "",
    file_name: "",
    file_type: "",
    existing_link: "",
    suggested_access: "anyone",
    suggested_expiry: "",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(LABEL_SHARE) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);
    const cp = parseComposeSectionYaml(body);

    if (!cp) {
      return {
        content: [{ type: "text", text: renderConfirmationText(LABEL_SHARE) }],
        structuredContent: { ...emptyPayload, action_id: actionId },
      };
    }

    const payload: SharePayload = {
      action_id: actionId,
      source_context: str(cp.source_context),
      file_path: str(cp.file_path),
      file_name: str(cp.file_name),
      file_type: str(cp.file_type),
      existing_link: str(cp.existing_link),
      suggested_access: str(cp.suggested_access) || "anyone",
      suggested_expiry: str(cp.suggested_expiry),
    };

    return {
      content: [{ type: "text", text: renderConfirmationText(LABEL_SHARE) }],
      structuredContent: payload,
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(LABEL_SHARE) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

// ── Handler 2: organize ──────────────────────────────────────────────────────

interface OrganizeArgs {
  action_id: string;
}

interface OrganizePayload {
  action_id: string;
  source_context: string;
  item_path: string;
  item_name: string;
  item_type: string;
  suggested_destination: string;
  mode: string;
}

async function handleOrganize(
  args: OrganizeArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: OrganizePayload;
}> {
  const emptyPayload: OrganizePayload = {
    action_id: "",
    source_context: "",
    item_path: "",
    item_name: "",
    item_type: "",
    suggested_destination: "",
    mode: "move",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(LABEL_ORGANIZE) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);
    const cp = parseComposeSectionYaml(body);

    if (!cp) {
      return {
        content: [{ type: "text", text: renderConfirmationText(LABEL_ORGANIZE) }],
        structuredContent: { ...emptyPayload, action_id: actionId },
      };
    }

    const payload: OrganizePayload = {
      action_id: actionId,
      source_context: str(cp.source_context),
      item_path: str(cp.item_path),
      item_name: str(cp.item_name),
      item_type: str(cp.item_type),
      suggested_destination: str(cp.suggested_destination),
      mode: str(cp.mode) || "move",
    };

    return {
      content: [{ type: "text", text: renderConfirmationText(LABEL_ORGANIZE) }],
      structuredContent: payload,
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(LABEL_ORGANIZE) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

// ── Handler 3: new_folder ────────────────────────────────────────────────────

interface NewFolderArgs {
  action_id: string;
}

interface NewFolderPayload {
  action_id: string;
  source_context: string;
  parent_path: string;
  parent_name: string;
  suggested_folder_name: string;
}

async function handleNewFolder(
  args: NewFolderArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: NewFolderPayload;
}> {
  const emptyPayload: NewFolderPayload = {
    action_id: "",
    source_context: "",
    parent_path: "",
    parent_name: "",
    suggested_folder_name: "",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(LABEL_NEW_FOLDER) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);
    const cp = parseComposeSectionYaml(body);

    if (!cp) {
      return {
        content: [{ type: "text", text: renderConfirmationText(LABEL_NEW_FOLDER) }],
        structuredContent: { ...emptyPayload, action_id: actionId },
      };
    }

    const payload: NewFolderPayload = {
      action_id: actionId,
      source_context: str(cp.source_context),
      parent_path: str(cp.parent_path),
      parent_name: str(cp.parent_name),
      suggested_folder_name: str(cp.suggested_folder_name),
    };

    return {
      content: [{ type: "text", text: renderConfirmationText(LABEL_NEW_FOLDER) }],
      structuredContent: payload,
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(LABEL_NEW_FOLDER) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

// ── Handler 4: file_request ──────────────────────────────────────────────────

interface FileRequestArgs {
  action_id: string;
}

interface FileRequestPayload {
  action_id: string;
  source_context: string;
  destination_path: string;
  destination_name: string;
  suggested_title: string;
  suggested_deadline: string;
}

async function handleFileRequest(
  args: FileRequestArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: FileRequestPayload;
}> {
  const emptyPayload: FileRequestPayload = {
    action_id: "",
    source_context: "",
    destination_path: "",
    destination_name: "",
    suggested_title: "",
    suggested_deadline: "",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(LABEL_FILE_REQUEST) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);
    const cp = parseComposeSectionYaml(body);

    if (!cp) {
      return {
        content: [{ type: "text", text: renderConfirmationText(LABEL_FILE_REQUEST) }],
        structuredContent: { ...emptyPayload, action_id: actionId },
      };
    }

    const payload: FileRequestPayload = {
      action_id: actionId,
      source_context: str(cp.source_context),
      destination_path: str(cp.destination_path),
      destination_name: str(cp.destination_name),
      suggested_title: str(cp.suggested_title),
      suggested_deadline: str(cp.suggested_deadline),
    };

    return {
      content: [{ type: "text", text: renderConfirmationText(LABEL_FILE_REQUEST) }],
      structuredContent: payload,
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(LABEL_FILE_REQUEST) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

// ── Descriptors ───────────────────────────────────────────────────────────────

const shareViewTool: ViewTool<ShareArgs, SharePayload> = {
  descriptor: {
    name: "agntux_dropbox_share",
    description:
      "Use this to create a shareable link for a Dropbox file. Shown when the user wants to share a file from an AgntUX action item. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host renders into an interactive iframe shown above the next assistant turn. " +
      "TRIGGER PHRASES: 'open the share composer for action {id}' → call with {action_id: id}. " +
      "The tool reads the action file's '## Compose payload' body section and lifts " +
      "file_path, file_name, file_type, existing_link, suggested_access, and suggested_expiry from disk. " +
      "Do NOT pass those fields inline.",
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
        file_path: { type: "string" },
        file_name: { type: "string" },
        file_type: { type: "string" },
        existing_link: { type: "string" },
        suggested_access: { type: "string" },
        suggested_expiry: { type: "string" },
      },
      required: [
        "action_id",
        "source_context",
        "file_path",
        "file_name",
        "file_type",
        "existing_link",
        "suggested_access",
        "suggested_expiry",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: SHARE_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleShare,
};

const organizeViewTool: ViewTool<OrganizeArgs, OrganizePayload> = {
  descriptor: {
    name: "agntux_dropbox_organize",
    description:
      "Use this to move or copy a Dropbox file or folder. Shown when the user wants to organize a file from an AgntUX action item. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host renders into an interactive iframe shown above the next assistant turn. " +
      "TRIGGER PHRASES: 'open the organize composer for action {id}' → call with {action_id: id}. " +
      "The tool reads the action file's '## Compose payload' body section and lifts " +
      "item_path, item_name, item_type, suggested_destination, and mode from disk. " +
      "Do NOT pass those fields inline.",
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
        item_path: { type: "string" },
        item_name: { type: "string" },
        item_type: { type: "string" },
        suggested_destination: { type: "string" },
        mode: { type: "string" },
      },
      required: [
        "action_id",
        "source_context",
        "item_path",
        "item_name",
        "item_type",
        "suggested_destination",
        "mode",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: ORGANIZE_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleOrganize,
};

const newFolderViewTool: ViewTool<NewFolderArgs, NewFolderPayload> = {
  descriptor: {
    name: "agntux_dropbox_new_folder",
    description:
      "Use this to create a new folder in Dropbox. Shown when the user wants to create a folder from an AgntUX action item. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host renders into an interactive iframe shown above the next assistant turn. " +
      "TRIGGER PHRASES: 'open the new-folder composer for action {id}' → call with {action_id: id}. " +
      "The tool reads the action file's '## Compose payload' body section and lifts " +
      "parent_path, parent_name, and suggested_folder_name from disk. " +
      "Do NOT pass those fields inline.",
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
        parent_path: { type: "string" },
        parent_name: { type: "string" },
        suggested_folder_name: { type: "string" },
      },
      required: [
        "action_id",
        "source_context",
        "parent_path",
        "parent_name",
        "suggested_folder_name",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: NEW_FOLDER_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleNewFolder,
};

const fileRequestViewTool: ViewTool<FileRequestArgs, FileRequestPayload> = {
  descriptor: {
    name: "agntux_dropbox_file_request",
    description:
      "Use this to create a Dropbox file request — a link people can use to upload files even without a Dropbox account. Shown when the user wants to request a file upload from an AgntUX action item. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host renders into an interactive iframe shown above the next assistant turn. " +
      "TRIGGER PHRASES: 'open the file-request composer for action {id}' → call with {action_id: id}. " +
      "The tool reads the action file's '## Compose payload' body section and lifts " +
      "destination_path, destination_name, suggested_title, and suggested_deadline from disk. " +
      "Do NOT pass those fields inline.",
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
        destination_path: { type: "string" },
        destination_name: { type: "string" },
        suggested_title: { type: "string" },
        suggested_deadline: { type: "string" },
      },
      required: [
        "action_id",
        "source_context",
        "destination_path",
        "destination_name",
        "suggested_title",
        "suggested_deadline",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: FILE_REQUEST_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleFileRequest,
};

// ── Default export ────────────────────────────────────────────────────────────

const mod: ViewToolModule = {
  viewTools: [shareViewTool, organizeViewTool, newFolderViewTool, fileRequestViewTool],
};
export default mod;
