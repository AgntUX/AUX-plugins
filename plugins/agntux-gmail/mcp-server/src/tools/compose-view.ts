// =============================================================================
// compose_view — render tool for the agntux-gmail Gmail reply compose MCP App.
//
// Shape rules (mirrors agntux-slack/mcp-server/src/tools/compose-view.ts):
//   - The sync skill pre-composed the draft body, thread context, recipients,
//     and reply_to_message_id at ingest time and stored them in the action
//     file's `## Compose payload` body section (or the namespaced
//     `## Compose payload (gmail)` for cross-source-merged actions). This
//     tool reads <root>/actions/{action_id}.md, verifies the action is still
//     open (not done/dismissed/snoozed-future), and lifts the payload — it
//     does NOT call Gmail tools (read-only, stateless).
//   - Hard caps are enforced server-side. Never throws from the happy path.
//
// Returns:
//   On success — { structuredContent: ComposePayload, content: [...], _meta }
//   On error   — { structuredContent: { error: '...' }, content: [...], _meta }
//
// Committed-envelope encoding (1.0.0):
//   The component emits a TWO-STEP envelope addressed at the user's Gmail
//   Connector — first call create_draft, then post a clickable link to the
//   draft in chat. The Gmail MCP has no send-email tool; the user finishes
//   the Send action by clicking the link, opening the draft in Gmail, and
//   hitting Send inside Gmail itself.
// =============================================================================

import { statSync } from "node:fs";
import { join } from "node:path";
import { expectedAgntuxRoot } from "../agntux-root.js";
import { parseActionFile } from "../parse-action.js";

// ── Constants & caps ─────────────────────────────────────────────────────────

const COMPOSE_RESOURCE_URI = "ui://gmail-compose" as const;
const MAX_DRAFTED_BODY_CHARS = 4000;
const MAX_PERSONALIZATION_SIGNALS = 4;
const MAX_SIGNAL_CHARS = 120;
const MAX_PARTICIPANTS = 12;
const MAX_RECIPIENTS_PER_FIELD = 50;
const MAX_EXCERPT_CHARS = 300;
const MAX_EMAIL_CONTEXT_CHARS = 1000;
const MAX_SUBJECT_CHARS = 200;

// ── Types ────────────────────────────────────────────────────────────────────

interface Participant {
  real_name: string;
  email: string;
}

interface ThreadInfo {
  thread_id: string;
  subject: string;
  parent_message_id: string;
  parent_author_real_name: string;
  parent_author_email: string;
  parent_excerpt: string;
  last_message_id: string;
  last_author_real_name: string;
  last_author_email: string;
  last_excerpt: string;
  total_messages: number;
  participants: Participant[];
}

interface Recipients {
  to: string[];
  cc: string[];
  bcc: string[];
}

interface ComposeStructuredContent {
  action_id: string;
  thread: ThreadInfo;
  recipients: Recipients;
  reply_to_message_id: string;
  drafted_body: string;
  personalization_signals: string[];
  email_context: string;
  gmail_thread_url: string | null;
  user_email: string | null;
}

interface ComposeStructuredError {
  error:
    | "action_not_found"
    | "action_already_handled"
    | "agntux_root_missing"
    | "license_paused"
    | "compose_payload_missing";
}

interface ViewToolMeta {
  ui: {
    resourceUri: typeof COMPOSE_RESOURCE_URI;
    visibility: ["model", "app"];
  };
}

interface ViewToolSuccess {
  structuredContent: ComposeStructuredContent;
  content: Array<{ type: "text"; text: string }>;
  _meta: ViewToolMeta;
}

interface ViewToolError {
  structuredContent: ComposeStructuredError;
  content: Array<{ type: "text"; text: string }>;
  _meta: ViewToolMeta;
}

type ViewToolResult = ViewToolSuccess | ViewToolError;

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + "…";
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function structuredError(
  kind: ComposeStructuredError["error"],
  message: string,
): ViewToolError {
  return {
    structuredContent: { error: kind },
    content: [{ type: "text", text: message }],
    _meta: { ui: { resourceUri: COMPOSE_RESOURCE_URI, visibility: ["model", "app"] } },
  };
}

function isActionAlreadyHandled(status: string, snoozedUntil: string | null): boolean {
  if (status === "done" || status === "dismissed") return true;
  if (status === "snoozed" && snoozedUntil) {
    const until = new Date(snoozedUntil).getTime();
    if (Number.isFinite(until) && until > Date.now()) return true;
  }
  return false;
}

function deriveUserEmailFromUrl(gmailThreadUrl: string | null): string | null {
  if (!gmailThreadUrl) return null;
  const m = /[?&]authuser=([^&#]+)/.exec(gmailThreadUrl);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

// ── Tool descriptor ──────────────────────────────────────────────────────────

export const composeViewTool = {
  name: "agntux_gmail_compose_view",
  description:
    "Render the Gmail reply composer iframe for an action item. " +
    "TRIGGER PHRASE (map verbatim to args — do not paraphrase): " +
    "'open the email composer for action {id}' → call with {action_id: id}. " +
    "For this click-time prompt, pass ONLY action_id. The tool reads the " +
    "action file's `## Compose payload` body section (or " +
    "`## Compose payload (gmail)` for cross-source-merged actions) and lifts " +
    "drafted_body, thread_context, recipients, reply_to_message_id, " +
    "personalization_signals, email_context, and gmail_thread_url from disk. " +
    "Action files lacking a compose payload section surface the " +
    "`compose_payload_missing` structured error envelope. Returns " +
    "_meta.ui.resourceUri = ui://gmail-compose.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action_id: {
        type: "string",
        description: "Slug of the action item (from filename, no .md suffix).",
      },
    },
    required: ["action_id"],
  },
  _meta: {
    ui: {
      resourceUri: COMPOSE_RESOURCE_URI,
    },
  },
} as const;

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleComposeView(
  args: Record<string, unknown>,
): Promise<ViewToolResult> {
  const actionId = asString(args.action_id);
  if (!actionId || !/^[a-zA-Z0-9_-]+$/.test(actionId)) {
    return structuredError(
      "action_not_found",
      `compose_view: invalid action_id '${actionId}'.`,
    );
  }

  const root = expectedAgntuxRoot();
  const actionPath = join(root, "actions", `${actionId}.md`);

  try {
    statSync(actionPath);
  } catch {
    return structuredError(
      "action_not_found",
      `compose_view: action file not found at ${actionPath}.`,
    );
  }

  let parsed;
  try {
    parsed = parseActionFile(actionPath);
  } catch {
    return structuredError(
      "action_not_found",
      `compose_view: failed to parse action file ${actionPath}.`,
    );
  }

  const fm = parsed.frontmatter;
  if (isActionAlreadyHandled(fm.status, fm.snoozed_until)) {
    return structuredError(
      "action_already_handled",
      `compose_view: action ${actionId} is no longer open (status: ${fm.status}).`,
    );
  }

  const onDisk = parsed.compose_payload;
  if (!onDisk) {
    return structuredError(
      "compose_payload_missing",
      `compose_view: action ${actionId} has no \`## Compose payload\` body section.`,
    );
  }

  const draftedBody = truncate(onDisk.drafted_body, MAX_DRAFTED_BODY_CHARS);

  const personalizationSignals = onDisk.personalization_signals
    .slice(0, MAX_PERSONALIZATION_SIGNALS)
    .map((s) => truncate(s, MAX_SIGNAL_CHARS));

  const thread: ThreadInfo = {
    thread_id: onDisk.thread_context.thread_id,
    subject: truncate(onDisk.thread_context.subject, MAX_SUBJECT_CHARS),
    parent_message_id: onDisk.thread_context.parent_message_id,
    parent_author_real_name: onDisk.thread_context.parent_author_real_name,
    parent_author_email: onDisk.thread_context.parent_author_email,
    parent_excerpt: truncate(
      onDisk.thread_context.parent_excerpt,
      MAX_EXCERPT_CHARS,
    ),
    last_message_id: onDisk.thread_context.last_message_id,
    last_author_real_name: onDisk.thread_context.last_author_real_name,
    last_author_email: onDisk.thread_context.last_author_email,
    last_excerpt: truncate(
      onDisk.thread_context.last_excerpt,
      MAX_EXCERPT_CHARS,
    ),
    total_messages: onDisk.thread_context.total_messages,
    participants: onDisk.thread_context.participants.slice(0, MAX_PARTICIPANTS),
  };

  const recipients: Recipients = {
    to: onDisk.recipients.to.slice(0, MAX_RECIPIENTS_PER_FIELD),
    cc: onDisk.recipients.cc.slice(0, MAX_RECIPIENTS_PER_FIELD),
    bcc: onDisk.recipients.bcc.slice(0, MAX_RECIPIENTS_PER_FIELD),
  };

  const userEmail = deriveUserEmailFromUrl(onDisk.gmail_thread_url);

  const payload: ComposeStructuredContent = {
    action_id: actionId,
    thread,
    recipients,
    reply_to_message_id: onDisk.reply_to_message_id,
    drafted_body: draftedBody,
    personalization_signals: personalizationSignals,
    email_context: truncate(parsed.email_context, MAX_EMAIL_CONTEXT_CHARS),
    gmail_thread_url: onDisk.gmail_thread_url,
    user_email: userEmail,
  };

  return {
    structuredContent: payload,
    content: [
      {
        type: "text",
        text: `compose_view rendered for action ${actionId} (subject: "${thread.subject}", ${thread.total_messages} message(s)).`,
      },
    ],
    _meta: {
      ui: {
        resourceUri: COMPOSE_RESOURCE_URI,
        visibility: ["model", "app"],
      },
    },
  };
}
