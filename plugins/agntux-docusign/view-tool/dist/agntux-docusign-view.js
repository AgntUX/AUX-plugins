// src/agntux-docusign-view.ts
import {
  parseFrontmatter,
  extractSection,
  renderConfirmationText
} from "@agntux/plugin-runtime";
function str(v) {
  return typeof v === "string" ? v : "";
}
function num(v) {
  return typeof v === "number" ? v : 0;
}
var REMINDER_RESOURCE_URI = "ui://agntux-docusign/reminder";
var REMINDER_LABEL = "DocuSign Reminder";
async function handleReminder(args, ctx) {
  const emptyPayload = {
    account_id: "",
    envelope_id: "",
    envelope_subject: "",
    envelope_url: "",
    sent_date: "",
    days_outstanding: 0,
    pending_recipients: [],
    draft_message: ""
  };
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(REMINDER_LABEL) }],
      structuredContent: emptyPayload
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { frontmatter: _fm, body } = parseFrontmatter(text);
    const frontmatter = _fm;
    const recipientsSection = extractSection(body ?? "", "Pending recipients");
    const pending_recipients = recipientsSection.split("\n").map((line) => {
      const parts = line.split("|").map((s) => s.trim());
      if (parts.length < 2 || !parts[0]) return null;
      const rec = {
        name: parts[0],
        email: parts[1] ?? "",
        status: parts[2] ?? "waiting"
      };
      return rec;
    }).filter((r) => r !== null && !!r.name);
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
        draft_message: draftSection.trim()
      }
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(REMINDER_LABEL) }],
      structuredContent: { ...emptyPayload, envelope_id: actionId }
    };
  }
}
var reminderViewTool = {
  descriptor: {
    name: "agntux_docusign_reminder_view",
    description: "Use this to send a reminder to pending signers on a DocuSign envelope. Shows envelope context (subject, sent date, days outstanding, per-recipient status) and lets the user write an optional reminder message before sending. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false
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
              status: { type: "string" }
            },
            required: ["name", "email", "status"],
            additionalProperties: false
          }
        },
        draft_message: { type: "string" }
      },
      required: [
        "account_id",
        "envelope_id",
        "envelope_subject",
        "envelope_url",
        "sent_date",
        "days_outstanding",
        "pending_recipients",
        "draft_message"
      ],
      additionalProperties: false
    },
    ui_resource_uri: REMINDER_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleReminder
};
var VOID_RESOURCE_URI = "ui://agntux-docusign/void";
var VOID_LABEL = "DocuSign Void Envelope";
async function handleVoid(args, ctx) {
  const emptyPayload = {
    account_id: "",
    envelope_id: "",
    envelope_subject: "",
    envelope_url: "",
    sent_date: "",
    recipient_count: 0,
    draft_void_reason: ""
  };
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(VOID_LABEL) }],
      structuredContent: emptyPayload
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { frontmatter: _fm, body } = parseFrontmatter(text);
    const frontmatter = _fm;
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
        draft_void_reason: draftSection.trim()
      }
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(VOID_LABEL) }],
      structuredContent: { ...emptyPayload, envelope_id: actionId }
    };
  }
}
var voidViewTool = {
  descriptor: {
    name: "agntux_docusign_void_view",
    description: "Use this to void a DocuSign envelope. Shows envelope context (subject, sent date, status, recipient count) and requires the user to enter a void reason before confirming. All recipients will be notified with the void reason. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false
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
        draft_void_reason: { type: "string" }
      },
      required: [
        "account_id",
        "envelope_id",
        "envelope_subject",
        "envelope_url",
        "sent_date",
        "recipient_count",
        "draft_void_reason"
      ],
      additionalProperties: false
    },
    ui_resource_uri: VOID_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleVoid
};
var SIGN_RESOURCE_URI = "ui://agntux-docusign/sign";
var SIGN_LABEL = "DocuSign Review and Sign";
async function handleSign(args, ctx) {
  const emptyPayload = {
    envelope_id: "",
    envelope_subject: "",
    sender_name: "",
    sent_date: "",
    expiration_date: "",
    signer_position: "",
    signing_url: ""
  };
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(SIGN_LABEL) }],
      structuredContent: emptyPayload
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { frontmatter: _fm } = parseFrontmatter(text);
    const frontmatter = _fm;
    return {
      content: [{ type: "text", text: renderConfirmationText(SIGN_LABEL) }],
      structuredContent: {
        envelope_id: str(frontmatter.envelope_id),
        envelope_subject: str(frontmatter.envelope_subject ?? frontmatter.title),
        sender_name: str(frontmatter.sender_name),
        sent_date: str(frontmatter.sent_date),
        expiration_date: str(frontmatter.expiration_date),
        signer_position: str(frontmatter.signer_position),
        signing_url: str(frontmatter.signing_url)
      }
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(SIGN_LABEL) }],
      structuredContent: { ...emptyPayload, envelope_id: actionId }
    };
  }
}
var signViewTool = {
  descriptor: {
    name: "agntux_docusign_sign_view",
    description: "Use this when the connected user needs to review and sign a DocuSign envelope. Shows document context (subject, sender, sent date, expiration, signer position) and provides a prominent link to open the DocuSign signing ceremony. There is no commit button \u2014 signing happens in DocuSign's secure embedded ceremony. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false
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
        signing_url: { type: "string" }
      },
      required: [
        "envelope_id",
        "envelope_subject",
        "sender_name",
        "sent_date",
        "expiration_date",
        "signer_position",
        "signing_url"
      ],
      additionalProperties: false
    },
    ui_resource_uri: SIGN_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleSign
};
var mod = {
  viewTools: [reminderViewTool, voidViewTool, signViewTool]
};
var agntux_docusign_view_default = mod;
export {
  agntux_docusign_view_default as default
};
