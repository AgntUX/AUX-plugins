// =============================================================================
// payload-shape.test.ts — payload-shape regression guard for agntux-stripe.
//
// Tests ALL SIX view tools in the single module:
//   mod.viewTools[0] = agntux_stripe_refund_view          (RefundPayload)
//   mod.viewTools[1] = agntux_stripe_dispute_view         (DisputePayload)
//   mod.viewTools[2] = agntux_stripe_invoice_finalize_view (InvoiceFinalizePayload)
//   mod.viewTools[3] = agntux_stripe_invoice_void_view    (InvoiceVoidPayload)
//   mod.viewTools[4] = agntux_stripe_subscription_edit_view (SubscriptionEditPayload)
//   mod.viewTools[5] = agntux_stripe_subscription_cancel_view (SubscriptionCancelPayload)
//
// Assertions are grounded in handler OUTPUT (Golden Rule #1): the real
// structuredContent keys and byte size from calling viewTool.handle() with
// in-memory fixtures. NEVER grep _overrides/ prose (E30 rule).
//
// KEPT_KEYS are derived from the handler interface definitions in
// agntux-stripe-view.ts (read verbatim before writing this file):
//
//   RefundPayload lines 67–76:
//     action_id, payment_intent_id, charge_amount, currency, customer_label,
//     max_refundable, suggested_reason, open_url
//
//   DisputePayload lines 182–191:
//     action_id, dispute_id, charge_amount, currency, dispute_reason,
//     evidence_due_by, draft_evidence, customer_label, open_url
//
//   InvoiceFinalizePayload lines 302–311:
//     action_id, invoice_id, invoice_number, amount_due, currency,
//     customer_label, due_date, open_url
//
//   InvoiceVoidPayload lines 416–425:
//     action_id, invoice_id, invoice_number, amount_due, currency,
//     customer_label, status, open_url
//
//   SubscriptionEditPayload lines 532–541:
//     action_id, subscription_id, customer_label, current_status,
//     current_plan, current_quantity, current_period_end, open_url
//
//   SubscriptionCancelPayload lines 648–655:
//     action_id, subscription_id, customer_label, current_status,
//     current_period_end, open_url
//
// PAYLOAD_BUDGET_BYTES (set conservatively — all payloads are short scalar
// fields; no long body text fields in any handler):
//   Refund             — 20 KB
//   Dispute            — 30 KB  (draft_evidence can be moderate length)
//   InvoiceFinalize    — 20 KB
//   InvoiceVoid        — 20 KB
//   SubscriptionEdit   — 20 KB
//   SubscriptionCancel — 20 KB
//
// All handlers read the action file's `## Compose payload` fenced YAML block
// via extractFencedYaml(body, "Compose payload") — confirmed by reading
// agntux-stripe-view.ts parseComposePayload() lines 37–49.
// Action file fixtures are therefore authored with a YAML frontmatter header
// and a `## Compose payload` body section.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  ViewToolContext,
  ViewToolFs,
  ListWithMetaEntry,
  ViewToolScope,
} from "@agntux/plugin-runtime";
import { ViewToolFsError } from "@agntux/plugin-runtime";
import mod from "../src/agntux-stripe-view.js";

// ── Tunable knobs ─────────────────────────────────────────────────────────────

const REFUND_BUDGET_BYTES = 20 * 1024;
const DISPUTE_BUDGET_BYTES = 30 * 1024;
const INVOICE_FINALIZE_BUDGET_BYTES = 20 * 1024;
const INVOICE_VOID_BUDGET_BYTES = 20 * 1024;
const SUBSCRIPTION_EDIT_BUDGET_BYTES = 20 * 1024;
const SUBSCRIPTION_CANCEL_BUDGET_BYTES = 20 * 1024;

// ── KEPT_KEYS — derived from interface definitions in agntux-stripe-view.ts ──

/**
 * RefundPayload keys (lines 67–76)
 */
const REFUND_KEPT_KEYS = new Set([
  "action_id",
  "payment_intent_id",
  "charge_amount",
  "currency",
  "customer_label",
  "max_refundable",
  "suggested_reason",
  "open_url",
]);

/**
 * DisputePayload keys (lines 182–191)
 */
const DISPUTE_KEPT_KEYS = new Set([
  "action_id",
  "dispute_id",
  "charge_amount",
  "currency",
  "dispute_reason",
  "evidence_due_by",
  "draft_evidence",
  "customer_label",
  "open_url",
]);

/**
 * InvoiceFinalizePayload keys (lines 302–311)
 */
const INVOICE_FINALIZE_KEPT_KEYS = new Set([
  "action_id",
  "invoice_id",
  "invoice_number",
  "amount_due",
  "currency",
  "customer_label",
  "due_date",
  "open_url",
]);

/**
 * InvoiceVoidPayload keys (lines 416–425)
 */
const INVOICE_VOID_KEPT_KEYS = new Set([
  "action_id",
  "invoice_id",
  "invoice_number",
  "amount_due",
  "currency",
  "customer_label",
  "status",
  "open_url",
]);

/**
 * SubscriptionEditPayload keys (lines 532–541)
 */
const SUBSCRIPTION_EDIT_KEPT_KEYS = new Set([
  "action_id",
  "subscription_id",
  "customer_label",
  "current_status",
  "current_plan",
  "current_quantity",
  "current_period_end",
  "open_url",
]);

/**
 * SubscriptionCancelPayload keys (lines 648–655)
 */
const SUBSCRIPTION_CANCEL_KEPT_KEYS = new Set([
  "action_id",
  "subscription_id",
  "customer_label",
  "current_status",
  "current_period_end",
  "open_url",
]);

// ── In-memory fs ──────────────────────────────────────────────────────────────

function inMemoryFs(files: Record<string, string>): ViewToolFs {
  return {
    async readFile(path: string) {
      const content = files[path];
      if (content == null) throw new ViewToolFsError("not-found", path);
      return Buffer.from(content, "utf8");
    },
    async readMany(paths: string[]) {
      return paths.map((p) => {
        const c = files[p];
        return c != null ? Buffer.from(c, "utf8") : null;
      });
    },
    async list(prefix: string) {
      return Object.keys(files)
        .filter((k) => k.startsWith(prefix))
        .sort();
    },
    async listWithMeta(prefix: string): Promise<ListWithMetaEntry[]> {
      return Object.keys(files)
        .filter((k) => k.startsWith(prefix))
        .sort()
        .map((path) => ({ path, meta: null }));
    },
    async exists(path: string) {
      return Object.prototype.hasOwnProperty.call(files, path);
    },
  };
}

// ── Context factory ───────────────────────────────────────────────────────────

const FIXED_SCOPE: ViewToolScope = {
  user_id: "test-user",
  organization_id: "test-org",
};

function makeCtx(files: Record<string, string>, now?: Date): ViewToolContext {
  const fixedNow = now ?? new Date("2026-06-20T21:00:00Z");
  const ctx: ViewToolContext = {
    fs: inMemoryFs(files),
    scope: FIXED_SCOPE,
    now: () => fixedNow,
    log: () => undefined,
    withScope: () => makeCtx(files, fixedNow),
  };
  return ctx;
}

// ── Action file builders ───────────────────────────────────────────────────────
// The stripe view handlers read the action body via parseFrontmatter() and then
// extractFencedYaml(body, "Compose payload") — confirmed by reading
// agntux-stripe-view.ts parseComposePayload() lines 37–49.
//
// Action file shape:
//   ---
//   id: <id>
//   type: action
//   ---
//   (body prose)
//
//   ## Compose payload
//   ```yaml
//   <fields>
//   ```

function makeRefundActionFile(opts: {
  id: string;
  payment_intent_id?: string;
  charge_amount?: number;
  currency?: string;
  customer_label?: string;
  max_refundable?: number;
  suggested_reason?: string;
  open_url?: string;
}): string {
  const fm = [
    `id: ${opts.id}`,
    `type: action`,
  ].join("\n");
  const yaml = [
    `payment_intent_id: "${opts.payment_intent_id ?? "pi_test123"}"`,
    `charge_amount: ${opts.charge_amount ?? 5000}`,
    `currency: "${opts.currency ?? "usd"}"`,
    `customer_label: "${opts.customer_label ?? "Acme Corp"}"`,
    `max_refundable: ${opts.max_refundable ?? 5000}`,
    `suggested_reason: "${opts.suggested_reason ?? "requested_by_customer"}"`,
    `open_url: "${opts.open_url ?? "https://dashboard.stripe.com/payments/pi_test123"}"`,
  ].join("\n");
  return `---\n${fm}\n---\n\nRefund request.\n\n## Compose payload\n\`\`\`yaml\n${yaml}\n\`\`\`\n`;
}

function makeDisputeActionFile(opts: {
  id: string;
  dispute_id?: string;
  charge_amount?: number;
  currency?: string;
  dispute_reason?: string;
  evidence_due_by?: string;
  draft_evidence?: string;
  customer_label?: string;
  open_url?: string;
}): string {
  const fm = [
    `id: ${opts.id}`,
    `type: action`,
  ].join("\n");
  const yaml = [
    `dispute_id: "${opts.dispute_id ?? "dp_test456"}"`,
    `charge_amount: ${opts.charge_amount ?? 10000}`,
    `currency: "${opts.currency ?? "usd"}"`,
    `dispute_reason: "${opts.dispute_reason ?? "fraudulent"}"`,
    `evidence_due_by: "${opts.evidence_due_by ?? "2026-07-01T00:00:00Z"}"`,
    `draft_evidence: "${opts.draft_evidence ?? "The charge is legitimate."}"`,
    `customer_label: "${opts.customer_label ?? "Jane Doe"}"`,
    `open_url: "${opts.open_url ?? "https://dashboard.stripe.com/disputes/dp_test456"}"`,
  ].join("\n");
  return `---\n${fm}\n---\n\nDispute response needed.\n\n## Compose payload\n\`\`\`yaml\n${yaml}\n\`\`\`\n`;
}

function makeInvoiceFinalizeActionFile(opts: {
  id: string;
  invoice_id?: string;
  invoice_number?: string;
  amount_due?: number;
  currency?: string;
  customer_label?: string;
  due_date?: string;
  open_url?: string;
}): string {
  const fm = [
    `id: ${opts.id}`,
    `type: action`,
  ].join("\n");
  const yaml = [
    `invoice_id: "${opts.invoice_id ?? "in_test789"}"`,
    `invoice_number: "${opts.invoice_number ?? "INV-0042"}"`,
    `amount_due: ${opts.amount_due ?? 29900}`,
    `currency: "${opts.currency ?? "usd"}"`,
    `customer_label: "${opts.customer_label ?? "Beta Ltd"}"`,
    `due_date: "${opts.due_date ?? "2026-07-15T00:00:00Z"}"`,
    `open_url: "${opts.open_url ?? "https://dashboard.stripe.com/invoices/in_test789"}"`,
  ].join("\n");
  return `---\n${fm}\n---\n\nFinalize this draft invoice.\n\n## Compose payload\n\`\`\`yaml\n${yaml}\n\`\`\`\n`;
}

function makeInvoiceVoidActionFile(opts: {
  id: string;
  invoice_id?: string;
  invoice_number?: string;
  amount_due?: number;
  currency?: string;
  customer_label?: string;
  status?: string;
  open_url?: string;
}): string {
  const fm = [
    `id: ${opts.id}`,
    `type: action`,
  ].join("\n");
  const yaml = [
    `invoice_id: "${opts.invoice_id ?? "in_test000"}"`,
    `invoice_number: "${opts.invoice_number ?? "INV-0099"}"`,
    `amount_due: ${opts.amount_due ?? 19900}`,
    `currency: "${opts.currency ?? "usd"}"`,
    `customer_label: "${opts.customer_label ?? "Gamma Inc"}"`,
    `status: "${opts.status ?? "open"}"`,
    `open_url: "${opts.open_url ?? "https://dashboard.stripe.com/invoices/in_test000"}"`,
  ].join("\n");
  return `---\n${fm}\n---\n\nVoid this invoice.\n\n## Compose payload\n\`\`\`yaml\n${yaml}\n\`\`\`\n`;
}

function makeSubscriptionEditActionFile(opts: {
  id: string;
  subscription_id?: string;
  customer_label?: string;
  current_status?: string;
  current_plan?: string;
  current_quantity?: number;
  current_period_end?: string;
  open_url?: string;
}): string {
  const fm = [
    `id: ${opts.id}`,
    `type: action`,
  ].join("\n");
  const yaml = [
    `subscription_id: "${opts.subscription_id ?? "sub_testAAA"}"`,
    `customer_label: "${opts.customer_label ?? "Delta LLC"}"`,
    `current_status: "${opts.current_status ?? "active"}"`,
    `current_plan: "${opts.current_plan ?? "Pro Monthly"}"`,
    `current_quantity: ${opts.current_quantity ?? 5}`,
    `current_period_end: "${opts.current_period_end ?? "2026-07-20T00:00:00Z"}"`,
    `open_url: "${opts.open_url ?? "https://dashboard.stripe.com/subscriptions/sub_testAAA"}"`,
  ].join("\n");
  return `---\n${fm}\n---\n\nEdit this subscription.\n\n## Compose payload\n\`\`\`yaml\n${yaml}\n\`\`\`\n`;
}

function makeSubscriptionCancelActionFile(opts: {
  id: string;
  subscription_id?: string;
  customer_label?: string;
  current_status?: string;
  current_period_end?: string;
  open_url?: string;
}): string {
  const fm = [
    `id: ${opts.id}`,
    `type: action`,
  ].join("\n");
  const yaml = [
    `subscription_id: "${opts.subscription_id ?? "sub_testBBB"}"`,
    `customer_label: "${opts.customer_label ?? "Epsilon Co"}"`,
    `current_status: "${opts.current_status ?? "active"}"`,
    `current_period_end: "${opts.current_period_end ?? "2026-07-31T00:00:00Z"}"`,
    `open_url: "${opts.open_url ?? "https://dashboard.stripe.com/subscriptions/sub_testBBB"}"`,
  ].join("\n");
  return `---\n${fm}\n---\n\nCancel this subscription.\n\n## Compose payload\n\`\`\`yaml\n${yaml}\n\`\`\`\n`;
}

// ── View tools under test ─────────────────────────────────────────────────────
// Order matches agntux-stripe-view.ts lines 750–757:
// viewTools: [refundViewTool, disputeViewTool, invoiceFinalizeViewTool,
//             invoiceVoidViewTool, subscriptionEditViewTool, subscriptionCancelViewTool]

const refundViewTool = mod.viewTools[0]!;
const disputeViewTool = mod.viewTools[1]!;
const invoiceFinalizeViewTool = mod.viewTools[2]!;
const invoiceVoidViewTool = mod.viewTools[3]!;
const subscriptionEditViewTool = mod.viewTools[4]!;
const subscriptionCancelViewTool = mod.viewTools[5]!;

// =============================================================================
// REFUND
// =============================================================================

describe("agntux_stripe_refund_view payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const files = {
      "actions/refund-1.md": makeRefundActionFile({
        id: "refund-1",
        customer_label: "A".repeat(200), // exercise a longer customer label
      }),
    };
    const result = await refundViewTool.handle({ action_id: "refund-1" }, makeCtx(files));
    const sc = result.structuredContent;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(REFUND_BUDGET_BYTES);
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/refund-k1.md": makeRefundActionFile({ id: "refund-k1" }),
    };
    const result = await refundViewTool.handle({ action_id: "refund-k1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(REFUND_KEPT_KEYS.has(k), `unexpected key "${k}" in refund structuredContent`).toBe(true);
    }
    for (const k of REFUND_KEPT_KEYS) {
      expect(keys.has(k), `missing required key "${k}" in refund structuredContent`).toBe(true);
    }
  });

  it("returns sensible field values from the Compose payload block", async () => {
    const files = {
      "actions/refund-v1.md": makeRefundActionFile({
        id: "refund-v1",
        payment_intent_id: "pi_abc999",
        charge_amount: 7500,
        currency: "usd",
        customer_label: "Test Corp",
        max_refundable: 7500,
        suggested_reason: "duplicate",
      }),
    };
    const result = await refundViewTool.handle({ action_id: "refund-v1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("refund-v1");
    expect(sc.payment_intent_id).toBe("pi_abc999");
    expect(sc.charge_amount).toBe(7500);
    expect(sc.currency).toBe("usd");
    expect(sc.customer_label).toBe("Test Corp");
    expect(sc.suggested_reason).toBe("duplicate");
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await refundViewTool.handle({ action_id: "does-not-exist" }, makeCtx({}));
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(REFUND_BUDGET_BYTES);
  });
});

describe("agntux_stripe_refund_view render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await refundViewTool.handle({} as { action_id: string }, makeCtx({}));
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(REFUND_KEPT_KEYS.has(k), `unexpected key "${k}" in refund placeholder`).toBe(true);
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(REFUND_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("degrades to a placeholder when ctx.fs throws an unexpected error", async () => {
    const ctx = makeCtx({});
    ctx.fs.readFile = async () => { throw new Error("boom: backend unavailable"); };
    const result = await refundViewTool.handle({ action_id: "anything" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Buffer.byteLength(JSON.stringify(sc), "utf8")).toBeLessThan(REFUND_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });
});

describe("agntux_stripe_refund_view response envelope guard", () => {
  function assertEnvelope(content: unknown) {
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0].type).toBe("text");
    const text = content[0].text as string;
    // Verbatim anchors from MCP_SUFFIX const in agntux-stripe-view.ts lines 51–57
    expect(text).toContain("iframe");
    expect(text).toContain("host");
    expect(text).toContain("MCP App");
  }

  it("success path ships the canonical content[] explanation", async () => {
    const files = { "actions/env-rf1.md": makeRefundActionFile({ id: "env-rf1" }) };
    const result = await refundViewTool.handle({ action_id: "env-rf1" }, makeCtx(files));
    assertEnvelope(result.content);
  });

  it("missing-file error branch also ships the canonical content[] explanation", async () => {
    const result = await refundViewTool.handle({ action_id: "missing" }, makeCtx({}));
    assertEnvelope(result.content);
  });
});

// =============================================================================
// DISPUTE
// =============================================================================

describe("agntux_stripe_dispute_view payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const heavyEvidence = "E".repeat(8000); // exercise long draft_evidence
    const files = {
      "actions/dispute-1.md": makeDisputeActionFile({ id: "dispute-1", draft_evidence: heavyEvidence }),
    };
    const result = await disputeViewTool.handle({ action_id: "dispute-1" }, makeCtx(files));
    const sc = result.structuredContent;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(DISPUTE_BUDGET_BYTES);
    expect((sc as Record<string, unknown>).draft_evidence).toBe(heavyEvidence);
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/dispute-k1.md": makeDisputeActionFile({ id: "dispute-k1" }),
    };
    const result = await disputeViewTool.handle({ action_id: "dispute-k1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(DISPUTE_KEPT_KEYS.has(k), `unexpected key "${k}" in dispute structuredContent`).toBe(true);
    }
    for (const k of DISPUTE_KEPT_KEYS) {
      expect(keys.has(k), `missing required key "${k}" in dispute structuredContent`).toBe(true);
    }
  });

  it("returns sensible field values from the Compose payload block", async () => {
    const files = {
      "actions/dispute-v1.md": makeDisputeActionFile({
        id: "dispute-v1",
        dispute_id: "dp_xyz789",
        dispute_reason: "product_not_received",
        evidence_due_by: "2026-07-10T00:00:00Z",
        customer_label: "Jane Smith",
      }),
    };
    const result = await disputeViewTool.handle({ action_id: "dispute-v1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("dispute-v1");
    expect(sc.dispute_id).toBe("dp_xyz789");
    expect(sc.dispute_reason).toBe("product_not_received");
    expect(sc.evidence_due_by).toBe("2026-07-10T00:00:00Z");
    expect(sc.customer_label).toBe("Jane Smith");
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await disputeViewTool.handle({ action_id: "does-not-exist" }, makeCtx({}));
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Buffer.byteLength(JSON.stringify(sc), "utf8")).toBeLessThan(DISPUTE_BUDGET_BYTES);
  });
});

describe("agntux_stripe_dispute_view render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await disputeViewTool.handle({} as { action_id: string }, makeCtx({}));
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(DISPUTE_KEPT_KEYS.has(k), `unexpected key "${k}" in dispute placeholder`).toBe(true);
    }
    expect(Buffer.byteLength(JSON.stringify(sc), "utf8")).toBeLessThan(DISPUTE_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("degrades to a placeholder when ctx.fs throws an unexpected error", async () => {
    const ctx = makeCtx({});
    ctx.fs.readFile = async () => { throw new Error("boom"); };
    const result = await disputeViewTool.handle({ action_id: "anything" }, ctx);
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8")).toBeLessThan(DISPUTE_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });
});

// =============================================================================
// INVOICE FINALIZE
// =============================================================================

describe("agntux_stripe_invoice_finalize_view payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const files = {
      "actions/inv-fin-1.md": makeInvoiceFinalizeActionFile({ id: "inv-fin-1" }),
    };
    const result = await invoiceFinalizeViewTool.handle({ action_id: "inv-fin-1" }, makeCtx(files));
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8")).toBeLessThan(INVOICE_FINALIZE_BUDGET_BYTES);
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/inv-fin-k1.md": makeInvoiceFinalizeActionFile({ id: "inv-fin-k1" }),
    };
    const result = await invoiceFinalizeViewTool.handle({ action_id: "inv-fin-k1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(INVOICE_FINALIZE_KEPT_KEYS.has(k), `unexpected key "${k}" in invoice-finalize structuredContent`).toBe(true);
    }
    for (const k of INVOICE_FINALIZE_KEPT_KEYS) {
      expect(keys.has(k), `missing required key "${k}" in invoice-finalize structuredContent`).toBe(true);
    }
  });

  it("returns sensible field values from the Compose payload block", async () => {
    const files = {
      "actions/inv-fin-v1.md": makeInvoiceFinalizeActionFile({
        id: "inv-fin-v1",
        invoice_id: "in_abc111",
        invoice_number: "INV-0099",
        amount_due: 14900,
        currency: "gbp",
        customer_label: "Zeta PLC",
        due_date: "2026-08-01T00:00:00Z",
      }),
    };
    const result = await invoiceFinalizeViewTool.handle({ action_id: "inv-fin-v1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("inv-fin-v1");
    expect(sc.invoice_id).toBe("in_abc111");
    expect(sc.invoice_number).toBe("INV-0099");
    expect(sc.amount_due).toBe(14900);
    expect(sc.currency).toBe("gbp");
    expect(sc.customer_label).toBe("Zeta PLC");
    expect(sc.due_date).toBe("2026-08-01T00:00:00Z");
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await invoiceFinalizeViewTool.handle({ action_id: "gone" }, makeCtx({}));
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8")).toBeLessThan(INVOICE_FINALIZE_BUDGET_BYTES);
  });
});

describe("agntux_stripe_invoice_finalize_view render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await invoiceFinalizeViewTool.handle({} as { action_id: string }, makeCtx({}));
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(INVOICE_FINALIZE_KEPT_KEYS.has(k), `unexpected key "${k}" in invoice-finalize placeholder`).toBe(true);
    }
    expect(Array.isArray(result.content)).toBe(true);
  });
});

// =============================================================================
// INVOICE VOID
// =============================================================================

describe("agntux_stripe_invoice_void_view payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const files = {
      "actions/inv-void-1.md": makeInvoiceVoidActionFile({ id: "inv-void-1" }),
    };
    const result = await invoiceVoidViewTool.handle({ action_id: "inv-void-1" }, makeCtx(files));
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8")).toBeLessThan(INVOICE_VOID_BUDGET_BYTES);
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/inv-void-k1.md": makeInvoiceVoidActionFile({ id: "inv-void-k1" }),
    };
    const result = await invoiceVoidViewTool.handle({ action_id: "inv-void-k1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(INVOICE_VOID_KEPT_KEYS.has(k), `unexpected key "${k}" in invoice-void structuredContent`).toBe(true);
    }
    for (const k of INVOICE_VOID_KEPT_KEYS) {
      expect(keys.has(k), `missing required key "${k}" in invoice-void structuredContent`).toBe(true);
    }
  });

  it("returns sensible field values from the Compose payload block", async () => {
    const files = {
      "actions/inv-void-v1.md": makeInvoiceVoidActionFile({
        id: "inv-void-v1",
        invoice_id: "in_void222",
        invoice_number: "INV-0055",
        amount_due: 9900,
        currency: "eur",
        customer_label: "Eta GmbH",
        status: "open",
      }),
    };
    const result = await invoiceVoidViewTool.handle({ action_id: "inv-void-v1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("inv-void-v1");
    expect(sc.invoice_id).toBe("in_void222");
    expect(sc.status).toBe("open");
    expect(sc.amount_due).toBe(9900);
    expect(sc.currency).toBe("eur");
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await invoiceVoidViewTool.handle({ action_id: "gone" }, makeCtx({}));
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8")).toBeLessThan(INVOICE_VOID_BUDGET_BYTES);
  });
});

describe("agntux_stripe_invoice_void_view render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await invoiceVoidViewTool.handle({} as { action_id: string }, makeCtx({}));
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(INVOICE_VOID_KEPT_KEYS.has(k), `unexpected key "${k}" in invoice-void placeholder`).toBe(true);
    }
    expect(Array.isArray(result.content)).toBe(true);
  });
});

// =============================================================================
// SUBSCRIPTION EDIT
// =============================================================================

describe("agntux_stripe_subscription_edit_view payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const files = {
      "actions/sub-edit-1.md": makeSubscriptionEditActionFile({ id: "sub-edit-1" }),
    };
    const result = await subscriptionEditViewTool.handle({ action_id: "sub-edit-1" }, makeCtx(files));
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8")).toBeLessThan(SUBSCRIPTION_EDIT_BUDGET_BYTES);
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/sub-edit-k1.md": makeSubscriptionEditActionFile({ id: "sub-edit-k1" }),
    };
    const result = await subscriptionEditViewTool.handle({ action_id: "sub-edit-k1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(SUBSCRIPTION_EDIT_KEPT_KEYS.has(k), `unexpected key "${k}" in subscription-edit structuredContent`).toBe(true);
    }
    for (const k of SUBSCRIPTION_EDIT_KEPT_KEYS) {
      expect(keys.has(k), `missing required key "${k}" in subscription-edit structuredContent`).toBe(true);
    }
  });

  it("returns sensible field values from the Compose payload block", async () => {
    const files = {
      "actions/sub-edit-v1.md": makeSubscriptionEditActionFile({
        id: "sub-edit-v1",
        subscription_id: "sub_abc123",
        customer_label: "Iota Ltd",
        current_status: "active",
        current_plan: "Enterprise Annual",
        current_quantity: 12,
        current_period_end: "2027-01-01T00:00:00Z",
      }),
    };
    const result = await subscriptionEditViewTool.handle({ action_id: "sub-edit-v1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("sub-edit-v1");
    expect(sc.subscription_id).toBe("sub_abc123");
    expect(sc.current_plan).toBe("Enterprise Annual");
    expect(sc.current_quantity).toBe(12);
    expect(sc.current_status).toBe("active");
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await subscriptionEditViewTool.handle({ action_id: "gone" }, makeCtx({}));
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8")).toBeLessThan(SUBSCRIPTION_EDIT_BUDGET_BYTES);
  });
});

describe("agntux_stripe_subscription_edit_view render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await subscriptionEditViewTool.handle({} as { action_id: string }, makeCtx({}));
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(SUBSCRIPTION_EDIT_KEPT_KEYS.has(k), `unexpected key "${k}" in subscription-edit placeholder`).toBe(true);
    }
    expect(Array.isArray(result.content)).toBe(true);
  });
});

// =============================================================================
// SUBSCRIPTION CANCEL
// =============================================================================

describe("agntux_stripe_subscription_cancel_view payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const files = {
      "actions/sub-cancel-1.md": makeSubscriptionCancelActionFile({ id: "sub-cancel-1" }),
    };
    const result = await subscriptionCancelViewTool.handle({ action_id: "sub-cancel-1" }, makeCtx(files));
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8")).toBeLessThan(SUBSCRIPTION_CANCEL_BUDGET_BYTES);
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/sub-cancel-k1.md": makeSubscriptionCancelActionFile({ id: "sub-cancel-k1" }),
    };
    const result = await subscriptionCancelViewTool.handle({ action_id: "sub-cancel-k1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(SUBSCRIPTION_CANCEL_KEPT_KEYS.has(k), `unexpected key "${k}" in subscription-cancel structuredContent`).toBe(true);
    }
    for (const k of SUBSCRIPTION_CANCEL_KEPT_KEYS) {
      expect(keys.has(k), `missing required key "${k}" in subscription-cancel structuredContent`).toBe(true);
    }
  });

  it("returns sensible field values from the Compose payload block", async () => {
    const files = {
      "actions/sub-cancel-v1.md": makeSubscriptionCancelActionFile({
        id: "sub-cancel-v1",
        subscription_id: "sub_xyz999",
        customer_label: "Kappa GmbH",
        current_status: "active",
        current_period_end: "2026-08-15T00:00:00Z",
      }),
    };
    const result = await subscriptionCancelViewTool.handle({ action_id: "sub-cancel-v1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("sub-cancel-v1");
    expect(sc.subscription_id).toBe("sub_xyz999");
    expect(sc.customer_label).toBe("Kappa GmbH");
    expect(sc.current_status).toBe("active");
    expect(sc.current_period_end).toBe("2026-08-15T00:00:00Z");
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await subscriptionCancelViewTool.handle({ action_id: "gone" }, makeCtx({}));
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8")).toBeLessThan(SUBSCRIPTION_CANCEL_BUDGET_BYTES);
  });
});

describe("agntux_stripe_subscription_cancel_view render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await subscriptionCancelViewTool.handle({} as { action_id: string }, makeCtx({}));
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(SUBSCRIPTION_CANCEL_KEPT_KEYS.has(k), `unexpected key "${k}" in subscription-cancel placeholder`).toBe(true);
    }
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("degrades to a placeholder when ctx.fs throws an unexpected error", async () => {
    const ctx = makeCtx({});
    ctx.fs.readFile = async () => { throw new Error("boom"); };
    const result = await subscriptionCancelViewTool.handle({ action_id: "anything" }, ctx);
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8")).toBeLessThan(SUBSCRIPTION_CANCEL_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });
});

// =============================================================================
// Descriptor contract — tool names, resource URIs, outputSchema, module count
// =============================================================================

describe("view tool descriptors", () => {
  it("module exports exactly 6 view tools", () => {
    // Verbatim from agntux-stripe-view.ts lines 750–757
    expect(mod.viewTools).toHaveLength(6);
  });

  it("refund tool name is agntux_stripe_refund_view", () => {
    // Verbatim from agntux-stripe-view.ts line 128
    expect(refundViewTool.descriptor.name).toBe("agntux_stripe_refund_view");
  });

  it("dispute tool name is agntux_stripe_dispute_view", () => {
    // Verbatim from agntux-stripe-view.ts line 246
    expect(disputeViewTool.descriptor.name).toBe("agntux_stripe_dispute_view");
  });

  it("invoice-finalize tool name is agntux_stripe_invoice_finalize_view", () => {
    // Verbatim from agntux-stripe-view.ts line 362
    expect(invoiceFinalizeViewTool.descriptor.name).toBe("agntux_stripe_invoice_finalize_view");
  });

  it("invoice-void tool name is agntux_stripe_invoice_void_view", () => {
    // Verbatim from agntux-stripe-view.ts line 478
    expect(invoiceVoidViewTool.descriptor.name).toBe("agntux_stripe_invoice_void_view");
  });

  it("subscription-edit tool name is agntux_stripe_subscription_edit_view", () => {
    // Verbatim from agntux-stripe-view.ts line 592
    expect(subscriptionEditViewTool.descriptor.name).toBe("agntux_stripe_subscription_edit_view");
  });

  it("subscription-cancel tool name is agntux_stripe_subscription_cancel_view", () => {
    // Verbatim from agntux-stripe-view.ts line 703
    expect(subscriptionCancelViewTool.descriptor.name).toBe("agntux_stripe_subscription_cancel_view");
  });

  it("refund resource URI is ui://agntux-stripe/refund", () => {
    // Verbatim from agntux-stripe-view.ts REFUND_URI const line 63
    expect(refundViewTool.descriptor.ui_resource_uri).toBe("ui://agntux-stripe/refund");
  });

  it("dispute resource URI is ui://agntux-stripe/dispute", () => {
    // Verbatim from agntux-stripe-view.ts DISPUTE_URI const line 178
    expect(disputeViewTool.descriptor.ui_resource_uri).toBe("ui://agntux-stripe/dispute");
  });

  it("invoice-finalize resource URI is ui://agntux-stripe/invoice-finalize", () => {
    // Verbatim from agntux-stripe-view.ts INVOICE_FINALIZE_URI const line 298
    expect(invoiceFinalizeViewTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-stripe/invoice-finalize",
    );
  });

  it("invoice-void resource URI is ui://agntux-stripe/invoice-void", () => {
    // Verbatim from agntux-stripe-view.ts INVOICE_VOID_URI const line 413
    expect(invoiceVoidViewTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-stripe/invoice-void",
    );
  });

  it("subscription-edit resource URI is ui://agntux-stripe/subscription-edit", () => {
    // Verbatim from agntux-stripe-view.ts SUBSCRIPTION_EDIT_URI const line 528
    expect(subscriptionEditViewTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-stripe/subscription-edit",
    );
  });

  it("subscription-cancel resource URI is ui://agntux-stripe/subscription-cancel", () => {
    // Verbatim from agntux-stripe-view.ts SUBSCRIPTION_CANCEL_URI const line 644
    expect(subscriptionCancelViewTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-stripe/subscription-cancel",
    );
  });

  it("refund outputSchema requires exactly REFUND_KEPT_KEYS", () => {
    const schema = refundViewTool.descriptor.outputSchema as { required: string[] };
    const required = new Set(schema.required);
    for (const k of REFUND_KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(true);
    }
    expect(schema.required.length).toBe(REFUND_KEPT_KEYS.size);
  });

  it("dispute outputSchema requires exactly DISPUTE_KEPT_KEYS", () => {
    const schema = disputeViewTool.descriptor.outputSchema as { required: string[] };
    const required = new Set(schema.required);
    for (const k of DISPUTE_KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(true);
    }
    expect(schema.required.length).toBe(DISPUTE_KEPT_KEYS.size);
  });

  it("invoice-finalize outputSchema requires exactly INVOICE_FINALIZE_KEPT_KEYS", () => {
    const schema = invoiceFinalizeViewTool.descriptor.outputSchema as { required: string[] };
    const required = new Set(schema.required);
    for (const k of INVOICE_FINALIZE_KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(true);
    }
    expect(schema.required.length).toBe(INVOICE_FINALIZE_KEPT_KEYS.size);
  });

  it("invoice-void outputSchema requires exactly INVOICE_VOID_KEPT_KEYS", () => {
    const schema = invoiceVoidViewTool.descriptor.outputSchema as { required: string[] };
    const required = new Set(schema.required);
    for (const k of INVOICE_VOID_KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(true);
    }
    expect(schema.required.length).toBe(INVOICE_VOID_KEPT_KEYS.size);
  });

  it("subscription-edit outputSchema requires exactly SUBSCRIPTION_EDIT_KEPT_KEYS", () => {
    const schema = subscriptionEditViewTool.descriptor.outputSchema as { required: string[] };
    const required = new Set(schema.required);
    for (const k of SUBSCRIPTION_EDIT_KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(true);
    }
    expect(schema.required.length).toBe(SUBSCRIPTION_EDIT_KEPT_KEYS.size);
  });

  it("subscription-cancel outputSchema requires exactly SUBSCRIPTION_CANCEL_KEPT_KEYS", () => {
    const schema = subscriptionCancelViewTool.descriptor.outputSchema as { required: string[] };
    const required = new Set(schema.required);
    for (const k of SUBSCRIPTION_CANCEL_KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(true);
    }
    expect(schema.required.length).toBe(SUBSCRIPTION_CANCEL_KEPT_KEYS.size);
  });
});
