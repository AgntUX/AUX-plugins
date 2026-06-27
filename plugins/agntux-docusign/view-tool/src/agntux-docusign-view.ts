// =============================================================================
// agntux-docusign-view.ts — view tools for the DocuSign MCP App.
//
// Three handlers:
//   agntux_docusign_reminder_view  (WRITE) — send reminder to pending signers
//   agntux_docusign_void_view      (WRITE) — void the envelope
//   agntux_docusign_sign_view      (OPEN-IN) — review and sign in DocuSign
//
// Runs on the remote MCP server. Each handler reads the backing action file
// from ctx.fs, projects a lean structuredContent payload, and returns it
// alongside renderConfirmationText() so the model does not re-narrate the
// iframe that the host has already materialised.
// =============================================================================

import {
  type ActionFrontmatter,
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  parseFrontmatter,
  extractSection,
  renderConfirmationText,
} from "@agntux/plugin-runtime";

// ── Shared helper ────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

// ── Handler 1: reminder ───────────────────────────────────────────────────────

const REMINDER_RESOURCE_URI = "ui://agntux-docusign/reminder" as const;
const REMINDER_LABEL = "DocuSign Reminder";

interface ReminderArgs {
  action_id?: string;
}

interface PendingRecipient {
  name: string;
  email: string;
  status: string;
}

interface ReminderPayload {
  account_id: string;
  envelope_id: string;
  envelope_subject: string;
  envelope_url: string;
  sent_date: string;
  days_outstanding: number;
  pending_recipients: PendingRecipient[];
  draft_message: string;
}

async function handleReminder(
  args: ReminderArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ReminderPayload;
}> {
  const emptyPayload: ReminderPayload = {
    account_id: "",
    envelope_id: "",
    envelope_subject: "",
    envelope_url: "",
    sent_date: "",
    days_outstanding: 0,
    pending_recipients: [],
    draft_message: "",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(REMINDER_LABEL) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { frontmatter: _fm, body } = parseFrontmatter(text);
    const frontmatter = _fm as ActionFrontmatter & Record<string, unknown>;

    // Parse pending recipients from the "Pending recipients" body section.
    // Each line is expected to be: "name | email | status"
    const recipientsSection = extractSection(body ?? "", "Pending recipients");
    const pending_recipients: PendingRecipient[] = recipientsSection
      .split("\n")
      .map((line): PendingRecipient | null => {
        const parts = line.split("|").map((s) => s.trim());
        if (parts.length < 2 || !parts[0]) return null;
        const rec: PendingRecipient = {
          name: parts[0],
          email: parts[1] ?? "",
          status: parts[2] ?? "waiting",
        };
        return rec;
      })
      .filter((r): r is PendingRecipient => r !== null && !!r.name);

    const draftSection = extractSection(body ?? "", "Draft message");

    return {
      content: [{ type: "text", text: renderConfirmationText(REMINDER_LABEL) }],
      structuredContent: {
        account_id: str(frontmatter.account_id),
        envelope_id: str(frontmatter.envelope_id),
        envelope_subject: str(frontmatter.envelope_subject ?? frontmatter.title),
        envelope_url: str(frontmatter.envelope_url ?? frontmatter.url),
        sent_date: str(frontmatter.sent_date),
        days_outstanding: num(frontmatter.days_outstanding),
        pending_recipients,
        draft_message: draftSection.trim(),
      },
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(REMINDER_LABEL) }],
      structuredContent: { ...emptyPayload, envelope_id: actionId },
    };
  }
}

const reminderViewTool: ViewTool<ReminderArgs, ReminderPayload> = {
  descriptor: {
    name: "agntux_docusign_reminder_view",
    description:
      "Use this to send a reminder to pending signers on a DocuSign envelope. " +
      "Shows envelope context (subject, sent date, days outstanding, per-recipient status) " +
      "and lets the user write an optional reminder message before sending. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        envelope_id: { type: "string" },
        envelope_subject: { type: "string" },
        envelope_url: { type: "string" },
        sent_date: { type: "string" },
        days_outstanding: { type: "number" },
        pending_recipients: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
              status: { type: "string" },
            },
            required: ["name", "email", "status"],
            additionalProperties: false,
          },
        },
        draft_message: { type: "string" },
      },
      required: [
        "account_id",
        "envelope_id",
        "envelope_subject",
        "envelope_url",
        "sent_date",
        "days_outstanding",
        "pending_recipients",
        "draft_message",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: REMINDER_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleReminder,
};

// ── Handler 2: void ───────────────────────────────────────────────────────────

const VOID_RESOURCE_URI = "ui://agntux-docusign/void" as const;
const VOID_LABEL = "DocuSign Void Envelope";

interface VoidArgs {
  action_id?: string;
}

interface VoidPayload {
  account_id: string;
  envelope_id: string;
  envelope_subject: string;
  envelope_url: string;
  sent_date: string;
  recipient_count: number;
  draft_void_reason: string;
}

async function handleVoid(
  args: VoidArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: VoidPayload;
}> {
  const emptyPayload: VoidPayload = {
    account_id: "",
    envelope_id: "",
    envelope_subject: "",
    envelope_url: "",
    sent_date: "",
    recipient_count: 0,
    draft_void_reason: "",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(VOID_LABEL) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { frontmatter: _fm, body } = parseFrontmatter(text);
    const frontmatter = _fm as ActionFrontmatter & Record<string, unknown>;

    const draftSection = extractSection(body ?? "", "Draft void reason");

    return {
      content: [{ type: "text", text: renderConfirmationText(VOID_LABEL) }],
      structuredContent: {
        account_id: str(frontmatter.account_id),
        envelope_id: str(frontmatter.envelope_id),
        envelope_subject: str(frontmatter.envelope_subject ?? frontmatter.title),
        envelope_url: str(frontmatter.envelope_url ?? frontmatter.url),
        sent_date: str(frontmatter.sent_date),
        recipient_count: num(frontmatter.recipient_count),
        draft_void_reason: draftSection.trim(),
      },
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(VOID_LABEL) }],
      structuredContent: { ...emptyPayload, envelope_id: actionId },
    };
  }
}

const voidViewTool: ViewTool<VoidArgs, VoidPayload> = {
  descriptor: {
    name: "agntux_docusign_void_view",
    description:
      "Use this to void a DocuSign envelope. Shows envelope context (subject, sent date, " +
      "status, recipient count) and requires the user to enter a void reason before confirming. " +
      "All recipients will be notified with the void reason. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        envelope_id: { type: "string" },
        envelope_subject: { type: "string" },
        envelope_url: { type: "string" },
        sent_date: { type: "string" },
        recipient_count: { type: "number" },
        draft_void_reason: { type: "string" },
      },
      required: [
        "account_id",
        "envelope_id",
        "envelope_subject",
        "envelope_url",
        "sent_date",
        "recipient_count",
        "draft_void_reason",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: VOID_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleVoid,
};

// ── Handler 3: sign ───────────────────────────────────────────────────────────

const SIGN_RESOURCE_URI = "ui://agntux-docusign/sign" as const;
const SIGN_LABEL = "DocuSign Review and Sign";

interface SignArgs {
  action_id?: string;
}

interface SignPayload {
  envelope_id: string;
  envelope_subject: string;
  sender_name: string;
  sent_date: string;
  expiration_date: string;
  signer_position: string;
  signing_url: string;
}

async function handleSign(
  args: SignArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: SignPayload;
}> {
  const emptyPayload: SignPayload = {
    envelope_id: "",
    envelope_subject: "",
    sender_name: "",
    sent_date: "",
    expiration_date: "",
    signer_position: "",
    signing_url: "",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(SIGN_LABEL) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { frontmatter: _fm } = parseFrontmatter(text);
    const frontmatter = _fm as ActionFrontmatter & Record<string, unknown>;

    return {
      content: [{ type: "text", text: renderConfirmationText(SIGN_LABEL) }],
      structuredContent: {
        envelope_id: str(frontmatter.envelope_id),
        envelope_subject: str(frontmatter.envelope_subject ?? frontmatter.title),
        sender_name: str(frontmatter.sender_name),
        sent_date: str(frontmatter.sent_date),
        expiration_date: str(frontmatter.expiration_date),
        signer_position: str(frontmatter.signer_position),
        signing_url: str(frontmatter.signing_url),
      },
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(SIGN_LABEL) }],
      structuredContent: { ...emptyPayload, envelope_id: actionId },
    };
  }
}

const signViewTool: ViewTool<SignArgs, SignPayload> = {
  descriptor: {
    name: "agntux_docusign_sign_view",
    description:
      "Use this when the connected user needs to review and sign a DocuSign envelope. " +
      "Shows document context (subject, sender, sent date, expiration, signer position) " +
      "and provides a prominent link to open the DocuSign signing ceremony. " +
      "There is no commit button — signing happens in DocuSign's secure embedded ceremony. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        envelope_id: { type: "string" },
        envelope_subject: { type: "string" },
        sender_name: { type: "string" },
        sent_date: { type: "string" },
        expiration_date: { type: "string" },
        signer_position: { type: "string" },
        signing_url: { type: "string" },
      },
      required: [
        "envelope_id",
        "envelope_subject",
        "sender_name",
        "sent_date",
        "expiration_date",
        "signer_position",
        "signing_url",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: SIGN_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleSign,
};

// ── Default export ────────────────────────────────────────────────────────────

const mod: ViewToolModule = {
  viewTools: [reminderViewTool, voidViewTool, signViewTool],
};
export default mod;
