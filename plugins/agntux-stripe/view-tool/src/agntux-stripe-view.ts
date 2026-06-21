// =============================================================================
// agntux-stripe-view — view tools for the Stripe source plugin.
//
// Exports SIX view tools, one per write-action handler:
//   1. agntux_stripe_refund_view          — refund a payment
//   2. agntux_stripe_dispute_view         — respond to a dispute
//   3. agntux_stripe_invoice_finalize_view — finalize an invoice
//   4. agntux_stripe_invoice_void_view    — void an invoice
//   5. agntux_stripe_subscription_edit_view — pause/update a subscription
//   6. agntux_stripe_subscription_cancel_view — cancel a subscription
//
// All handlers follow the render-harness safety contract:
//   - Guard action_id up front (never build `actions/undefined.md`).
//   - Catch-all around fs read + parse; degrade to placeholder, never rethrow.
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

// ── Shared helpers ─────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

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

const MCP_SUFFIX =
  "This tool is an MCP App view tool: it returns a structured data " +
  "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
  "renders into an interactive iframe shown above the next assistant " +
  "turn. The iframe is the user-visible result of calling this tool; " +
  "no additional chat output, summary, or visualization tool call is " +
  "needed afterwards.";

// =============================================================================
// 1. Refund view
// =============================================================================

const REFUND_URI = "ui://agntux-stripe/refund" as const;
const REFUND_LABEL = "Stripe refund";

interface RefundArgs { action_id: string; }
interface RefundPayload {
  action_id: string;
  payment_intent_id: string;
  charge_amount: number;
  currency: string;
  customer_label: string;
  max_refundable: number;
  suggested_reason: string;
  open_url: string;
}

const EMPTY_REFUND: RefundPayload = {
  action_id: "",
  payment_intent_id: "",
  charge_amount: 0,
  currency: "",
  customer_label: "",
  max_refundable: 0,
  suggested_reason: "",
  open_url: "",
};

async function handleRefund(
  args: RefundArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: RefundPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(REFUND_LABEL) }],
      structuredContent: EMPTY_REFUND,
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { body } = parseFrontmatter(buf.toString("utf8"));
    const cp = parseComposePayload(body);
    const payload: RefundPayload = {
      action_id: actionId,
      payment_intent_id: str(cp?.payment_intent_id),
      charge_amount: num(cp?.charge_amount),
      currency: str(cp?.currency),
      customer_label: str(cp?.customer_label),
      max_refundable: num(cp?.max_refundable),
      suggested_reason: str(cp?.suggested_reason),
      open_url: str(cp?.open_url),
    };
    return {
      content: [{ type: "text", text: renderConfirmationText(REFUND_LABEL) }],
      structuredContent: payload,
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(REFUND_LABEL) }],
      structuredContent: { ...EMPTY_REFUND, action_id: actionId },
    };
  }
}

const refundViewTool: ViewTool<RefundArgs, RefundPayload> = {
  descriptor: {
    name: "agntux_stripe_refund_view",
    description:
      "Use this to issue a refund for a Stripe payment. Shown when the user wants to refund a charge or payment intent from an AgntUX action item. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'open the refund composer for action {id}' → call with { action_id: id }; " +
      "'refund payment for action {id}' → call with { action_id: id }. " +
      "For these click-time prompts, pass ONLY action_id. " +
      "The tool reads the action file's `## Compose payload` body section and lifts payment_intent_id, charge_amount, currency, customer_label, max_refundable, suggested_reason, and open_url from disk. " +
      "Do NOT pass those fields inline — any inline value overrides the on-disk payload destructively, producing an empty UI. " +
      MCP_SUFFIX,
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
        payment_intent_id: { type: "string" },
        charge_amount: { type: "number" },
        currency: { type: "string" },
        customer_label: { type: "string" },
        max_refundable: { type: "number" },
        suggested_reason: { type: "string" },
        open_url: { type: "string" },
      },
      required: [
        "action_id",
        "payment_intent_id",
        "charge_amount",
        "currency",
        "customer_label",
        "max_refundable",
        "suggested_reason",
        "open_url",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: REFUND_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleRefund,
};

// =============================================================================
// 2. Dispute view
// =============================================================================

const DISPUTE_URI = "ui://agntux-stripe/dispute" as const;
const DISPUTE_LABEL = "Stripe dispute response";

interface DisputeArgs { action_id: string; }
interface DisputePayload {
  action_id: string;
  dispute_id: string;
  charge_amount: number;
  currency: string;
  dispute_reason: string;
  evidence_due_by: string;
  draft_evidence: string;
  customer_label: string;
  open_url: string;
}

const EMPTY_DISPUTE: DisputePayload = {
  action_id: "",
  dispute_id: "",
  charge_amount: 0,
  currency: "",
  dispute_reason: "",
  evidence_due_by: "",
  draft_evidence: "",
  customer_label: "",
  open_url: "",
};

async function handleDispute(
  args: DisputeArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: DisputePayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(DISPUTE_LABEL) }],
      structuredContent: EMPTY_DISPUTE,
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { body } = parseFrontmatter(buf.toString("utf8"));
    const cp = parseComposePayload(body);
    const payload: DisputePayload = {
      action_id: actionId,
      dispute_id: str(cp?.dispute_id),
      charge_amount: num(cp?.charge_amount),
      currency: str(cp?.currency),
      dispute_reason: str(cp?.dispute_reason),
      evidence_due_by: str(cp?.evidence_due_by),
      draft_evidence: str(cp?.draft_evidence),
      customer_label: str(cp?.customer_label),
      open_url: str(cp?.open_url),
    };
    return {
      content: [{ type: "text", text: renderConfirmationText(DISPUTE_LABEL) }],
      structuredContent: payload,
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(DISPUTE_LABEL) }],
      structuredContent: { ...EMPTY_DISPUTE, action_id: actionId },
    };
  }
}

const disputeViewTool: ViewTool<DisputeArgs, DisputePayload> = {
  descriptor: {
    name: "agntux_stripe_dispute_view",
    description:
      "Use this to respond to a Stripe dispute by submitting evidence. Shown when the user needs to reply to a chargeback from an AgntUX action item. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'open the dispute evidence composer for action {id}' → call with { action_id: id }; " +
      "'submit dispute evidence for action {id}' → call with { action_id: id }. " +
      "For these click-time prompts, pass ONLY action_id. " +
      "The tool reads the action file's `## Compose payload` body section and lifts dispute_id, charge_amount, currency, dispute_reason, evidence_due_by, draft_evidence, customer_label, and open_url from disk. " +
      "Do NOT pass those fields inline — any inline value overrides the on-disk payload destructively, producing an empty UI. " +
      MCP_SUFFIX,
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
        dispute_id: { type: "string" },
        charge_amount: { type: "number" },
        currency: { type: "string" },
        dispute_reason: { type: "string" },
        evidence_due_by: { type: "string" },
        draft_evidence: { type: "string" },
        customer_label: { type: "string" },
        open_url: { type: "string" },
      },
      required: [
        "action_id",
        "dispute_id",
        "charge_amount",
        "currency",
        "dispute_reason",
        "evidence_due_by",
        "draft_evidence",
        "customer_label",
        "open_url",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: DISPUTE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleDispute,
};

// =============================================================================
// 3. Invoice-finalize view
// =============================================================================

const INVOICE_FINALIZE_URI = "ui://agntux-stripe/invoice-finalize" as const;
const INVOICE_FINALIZE_LABEL = "Stripe invoice finalize";

interface InvoiceFinalizeArgs { action_id: string; }
interface InvoiceFinalizePayload {
  action_id: string;
  invoice_id: string;
  invoice_number: string;
  amount_due: number;
  currency: string;
  customer_label: string;
  due_date: string;
  open_url: string;
}

const EMPTY_INVOICE_FINALIZE: InvoiceFinalizePayload = {
  action_id: "",
  invoice_id: "",
  invoice_number: "",
  amount_due: 0,
  currency: "",
  customer_label: "",
  due_date: "",
  open_url: "",
};

async function handleInvoiceFinalize(
  args: InvoiceFinalizeArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: InvoiceFinalizePayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(INVOICE_FINALIZE_LABEL) }],
      structuredContent: EMPTY_INVOICE_FINALIZE,
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { body } = parseFrontmatter(buf.toString("utf8"));
    const cp = parseComposePayload(body);
    const payload: InvoiceFinalizePayload = {
      action_id: actionId,
      invoice_id: str(cp?.invoice_id),
      invoice_number: str(cp?.invoice_number),
      amount_due: num(cp?.amount_due),
      currency: str(cp?.currency),
      customer_label: str(cp?.customer_label),
      due_date: str(cp?.due_date),
      open_url: str(cp?.open_url),
    };
    return {
      content: [{ type: "text", text: renderConfirmationText(INVOICE_FINALIZE_LABEL) }],
      structuredContent: payload,
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(INVOICE_FINALIZE_LABEL) }],
      structuredContent: { ...EMPTY_INVOICE_FINALIZE, action_id: actionId },
    };
  }
}

const invoiceFinalizeViewTool: ViewTool<InvoiceFinalizeArgs, InvoiceFinalizePayload> = {
  descriptor: {
    name: "agntux_stripe_invoice_finalize_view",
    description:
      "Use this to finalize a Stripe draft invoice, locking it and sending it to the customer. Shown when the user wants to finalize an invoice from an AgntUX action item. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'open the invoice finalize composer for action {id}' → call with { action_id: id }; " +
      "'finalize invoice for action {id}' → call with { action_id: id }. " +
      "For these click-time prompts, pass ONLY action_id. " +
      "The tool reads the action file's `## Compose payload` body section and lifts invoice_id, invoice_number, amount_due, currency, customer_label, due_date, and open_url from disk. " +
      "Do NOT pass those fields inline — any inline value overrides the on-disk payload destructively, producing an empty UI. " +
      MCP_SUFFIX,
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
        invoice_id: { type: "string" },
        invoice_number: { type: "string" },
        amount_due: { type: "number" },
        currency: { type: "string" },
        customer_label: { type: "string" },
        due_date: { type: "string" },
        open_url: { type: "string" },
      },
      required: [
        "action_id",
        "invoice_id",
        "invoice_number",
        "amount_due",
        "currency",
        "customer_label",
        "due_date",
        "open_url",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: INVOICE_FINALIZE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleInvoiceFinalize,
};

// =============================================================================
// 4. Invoice-void view
// =============================================================================

const INVOICE_VOID_URI = "ui://agntux-stripe/invoice-void" as const;
const INVOICE_VOID_LABEL = "Stripe invoice void";

interface InvoiceVoidArgs { action_id: string; }
interface InvoiceVoidPayload {
  action_id: string;
  invoice_id: string;
  invoice_number: string;
  amount_due: number;
  currency: string;
  customer_label: string;
  status: string;
  open_url: string;
}

const EMPTY_INVOICE_VOID: InvoiceVoidPayload = {
  action_id: "",
  invoice_id: "",
  invoice_number: "",
  amount_due: 0,
  currency: "",
  customer_label: "",
  status: "",
  open_url: "",
};

async function handleInvoiceVoid(
  args: InvoiceVoidArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: InvoiceVoidPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(INVOICE_VOID_LABEL) }],
      structuredContent: EMPTY_INVOICE_VOID,
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { body } = parseFrontmatter(buf.toString("utf8"));
    const cp = parseComposePayload(body);
    const payload: InvoiceVoidPayload = {
      action_id: actionId,
      invoice_id: str(cp?.invoice_id),
      invoice_number: str(cp?.invoice_number),
      amount_due: num(cp?.amount_due),
      currency: str(cp?.currency),
      customer_label: str(cp?.customer_label),
      status: str(cp?.status),
      open_url: str(cp?.open_url),
    };
    return {
      content: [{ type: "text", text: renderConfirmationText(INVOICE_VOID_LABEL) }],
      structuredContent: payload,
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(INVOICE_VOID_LABEL) }],
      structuredContent: { ...EMPTY_INVOICE_VOID, action_id: actionId },
    };
  }
}

const invoiceVoidViewTool: ViewTool<InvoiceVoidArgs, InvoiceVoidPayload> = {
  descriptor: {
    name: "agntux_stripe_invoice_void_view",
    description:
      "Use this to void a Stripe invoice, marking it uncollectable. This action is irreversible. Shown when the user wants to void an invoice from an AgntUX action item. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'open the invoice void composer for action {id}' → call with { action_id: id }; " +
      "'void invoice for action {id}' → call with { action_id: id }. " +
      "For these click-time prompts, pass ONLY action_id. " +
      "The tool reads the action file's `## Compose payload` body section and lifts invoice_id, invoice_number, amount_due, currency, customer_label, status, and open_url from disk. " +
      "Do NOT pass those fields inline — any inline value overrides the on-disk payload destructively, producing an empty UI. " +
      MCP_SUFFIX,
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
        invoice_id: { type: "string" },
        invoice_number: { type: "string" },
        amount_due: { type: "number" },
        currency: { type: "string" },
        customer_label: { type: "string" },
        status: { type: "string" },
        open_url: { type: "string" },
      },
      required: [
        "action_id",
        "invoice_id",
        "invoice_number",
        "amount_due",
        "currency",
        "customer_label",
        "status",
        "open_url",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: INVOICE_VOID_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleInvoiceVoid,
};

// =============================================================================
// 5. Subscription-edit view
// =============================================================================

const SUBSCRIPTION_EDIT_URI = "ui://agntux-stripe/subscription-edit" as const;
const SUBSCRIPTION_EDIT_LABEL = "Stripe subscription edit";

interface SubscriptionEditArgs { action_id: string; }
interface SubscriptionEditPayload {
  action_id: string;
  subscription_id: string;
  customer_label: string;
  current_status: string;
  current_plan: string;
  current_quantity: number;
  current_period_end: string;
  open_url: string;
}

const EMPTY_SUBSCRIPTION_EDIT: SubscriptionEditPayload = {
  action_id: "",
  subscription_id: "",
  customer_label: "",
  current_status: "",
  current_plan: "",
  current_quantity: 0,
  current_period_end: "",
  open_url: "",
};

async function handleSubscriptionEdit(
  args: SubscriptionEditArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: SubscriptionEditPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(SUBSCRIPTION_EDIT_LABEL) }],
      structuredContent: EMPTY_SUBSCRIPTION_EDIT,
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { body } = parseFrontmatter(buf.toString("utf8"));
    const cp = parseComposePayload(body);
    const payload: SubscriptionEditPayload = {
      action_id: actionId,
      subscription_id: str(cp?.subscription_id),
      customer_label: str(cp?.customer_label),
      current_status: str(cp?.current_status),
      current_plan: str(cp?.current_plan),
      current_quantity: num(cp?.current_quantity),
      current_period_end: str(cp?.current_period_end),
      open_url: str(cp?.open_url),
    };
    return {
      content: [{ type: "text", text: renderConfirmationText(SUBSCRIPTION_EDIT_LABEL) }],
      structuredContent: payload,
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(SUBSCRIPTION_EDIT_LABEL) }],
      structuredContent: { ...EMPTY_SUBSCRIPTION_EDIT, action_id: actionId },
    };
  }
}

const subscriptionEditViewTool: ViewTool<SubscriptionEditArgs, SubscriptionEditPayload> = {
  descriptor: {
    name: "agntux_stripe_subscription_edit_view",
    description:
      "Use this to pause or update a Stripe subscription — change quantity or pause collection. Shown when the user wants to manage a subscription from an AgntUX action item. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'open the subscription edit composer for action {id}' → call with { action_id: id }; " +
      "'edit subscription for action {id}' → call with { action_id: id }; " +
      "'pause subscription for action {id}' → call with { action_id: id }. " +
      "For these click-time prompts, pass ONLY action_id. " +
      "The tool reads the action file's `## Compose payload` body section and lifts subscription_id, customer_label, current_status, current_plan, current_quantity, current_period_end, and open_url from disk. " +
      "Do NOT pass those fields inline — any inline value overrides the on-disk payload destructively, producing an empty UI. " +
      MCP_SUFFIX,
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
        subscription_id: { type: "string" },
        customer_label: { type: "string" },
        current_status: { type: "string" },
        current_plan: { type: "string" },
        current_quantity: { type: "number" },
        current_period_end: { type: "string" },
        open_url: { type: "string" },
      },
      required: [
        "action_id",
        "subscription_id",
        "customer_label",
        "current_status",
        "current_plan",
        "current_quantity",
        "current_period_end",
        "open_url",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: SUBSCRIPTION_EDIT_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleSubscriptionEdit,
};

// =============================================================================
// 6. Subscription-cancel view
// =============================================================================

const SUBSCRIPTION_CANCEL_URI = "ui://agntux-stripe/subscription-cancel" as const;
const SUBSCRIPTION_CANCEL_LABEL = "Stripe subscription cancel";

interface SubscriptionCancelArgs { action_id: string; }
interface SubscriptionCancelPayload {
  action_id: string;
  subscription_id: string;
  customer_label: string;
  current_status: string;
  current_period_end: string;
  open_url: string;
}

const EMPTY_SUBSCRIPTION_CANCEL: SubscriptionCancelPayload = {
  action_id: "",
  subscription_id: "",
  customer_label: "",
  current_status: "",
  current_period_end: "",
  open_url: "",
};

async function handleSubscriptionCancel(
  args: SubscriptionCancelArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: SubscriptionCancelPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(SUBSCRIPTION_CANCEL_LABEL) }],
      structuredContent: EMPTY_SUBSCRIPTION_CANCEL,
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { body } = parseFrontmatter(buf.toString("utf8"));
    const cp = parseComposePayload(body);
    const payload: SubscriptionCancelPayload = {
      action_id: actionId,
      subscription_id: str(cp?.subscription_id),
      customer_label: str(cp?.customer_label),
      current_status: str(cp?.current_status),
      current_period_end: str(cp?.current_period_end),
      open_url: str(cp?.open_url),
    };
    return {
      content: [{ type: "text", text: renderConfirmationText(SUBSCRIPTION_CANCEL_LABEL) }],
      structuredContent: payload,
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(SUBSCRIPTION_CANCEL_LABEL) }],
      structuredContent: { ...EMPTY_SUBSCRIPTION_CANCEL, action_id: actionId },
    };
  }
}

const subscriptionCancelViewTool: ViewTool<SubscriptionCancelArgs, SubscriptionCancelPayload> = {
  descriptor: {
    name: "agntux_stripe_subscription_cancel_view",
    description:
      "Use this to cancel a Stripe subscription, either at the end of the current billing period (the default) or immediately. Shown when the user wants to cancel a subscription from an AgntUX action item. " +
      "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
      "'open the subscription cancel composer for action {id}' → call with { action_id: id }; " +
      "'cancel subscription for action {id}' → call with { action_id: id }. " +
      "For these click-time prompts, pass ONLY action_id. " +
      "The tool reads the action file's `## Compose payload` body section and lifts subscription_id, customer_label, current_status, current_period_end, and open_url from disk. " +
      "Do NOT pass those fields inline — any inline value overrides the on-disk payload destructively, producing an empty UI. " +
      MCP_SUFFIX,
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
        subscription_id: { type: "string" },
        customer_label: { type: "string" },
        current_status: { type: "string" },
        current_period_end: { type: "string" },
        open_url: { type: "string" },
      },
      required: [
        "action_id",
        "subscription_id",
        "customer_label",
        "current_status",
        "current_period_end",
        "open_url",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: SUBSCRIPTION_CANCEL_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleSubscriptionCancel,
};

// =============================================================================
// Default export
// =============================================================================

const mod: ViewToolModule = {
  viewTools: [
    refundViewTool,
    disputeViewTool,
    invoiceFinalizeViewTool,
    invoiceVoidViewTool,
    subscriptionEditViewTool,
    subscriptionCancelViewTool,
  ],
};
export default mod;
