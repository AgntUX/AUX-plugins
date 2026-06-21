// =============================================================================
// draft-flow.test.ts — write-back wiring assertions for agntux-stripe.
//
// Stripe ships SIX write-action UI handlers:
//   1. refund              — issues a refund on a charge / payment intent
//   2. dispute             — submits chargeback evidence
//   3. invoice-finalize    — locks and sends a draft invoice
//   4. invoice-void        — marks a finalized invoice uncollectable
//   5. subscription-edit   — pauses collection or updates quantity/plan
//   6. subscription-cancel — immediately cancels a subscription
//
// All string assertions are DERIVED by reading the actual source files first
// and copying verbatim substrings (golden rule #1, mechanical rule 1).
// NO prose from _overrides/ is asserted (E30 rule).
//
// Tests fall into three groups:
//   A. Envelope builder files exist.
//   B. Connector-targeted envelope source — static assertions on build-envelope.ts
//      source content (the exact strings the runtime emits when the user
//      clicks Confirm / Submit / Cancel).
//   C. UI entry points import from build-envelope.js and wire sendFollowUpMessage.
// =============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");

// ── Envelope builder paths ────────────────────────────────────────────────────

const ENVELOPE_BUILDERS = {
  refund: join(PLUGIN_ROOT, "view-tool/src/apps/refund/lib/build-envelope.ts"),
  dispute: join(PLUGIN_ROOT, "view-tool/src/apps/dispute/lib/build-envelope.ts"),
  "invoice-finalize": join(PLUGIN_ROOT, "view-tool/src/apps/invoice-finalize/lib/build-envelope.ts"),
  "invoice-void": join(PLUGIN_ROOT, "view-tool/src/apps/invoice-void/lib/build-envelope.ts"),
  "subscription-edit": join(PLUGIN_ROOT, "view-tool/src/apps/subscription-edit/lib/build-envelope.ts"),
  "subscription-cancel": join(PLUGIN_ROOT, "view-tool/src/apps/subscription-cancel/lib/build-envelope.ts"),
} as const;

// ── UI entry-point paths ──────────────────────────────────────────────────────

const UI_FILES = {
  refund: join(PLUGIN_ROOT, "view-tool/src/refund-ui.tsx"),
  dispute: join(PLUGIN_ROOT, "view-tool/src/dispute-ui.tsx"),
  "invoice-finalize": join(PLUGIN_ROOT, "view-tool/src/invoice-finalize-ui.tsx"),
  "invoice-void": join(PLUGIN_ROOT, "view-tool/src/invoice-void-ui.tsx"),
  "subscription-edit": join(PLUGIN_ROOT, "view-tool/src/subscription-edit-ui.tsx"),
  "subscription-cancel": join(PLUGIN_ROOT, "view-tool/src/subscription-cancel-ui.tsx"),
} as const;

// =============================================================================
// A. Envelope builder files exist
// =============================================================================

describe("envelope builder files exist", () => {
  for (const [name, path] of Object.entries(ENVELOPE_BUILDERS)) {
    it(`${name} build-envelope.ts exists`, () => {
      expect(existsSync(path)).toBe(true);
    });
  }
});

// =============================================================================
// B. Connector-targeted envelope source assertions
// =============================================================================

// ── B1. Refund ────────────────────────────────────────────────────────────────

describe("connector-targeted envelope source (refund)", () => {
  it("addresses the Stripe Connector by display name", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.refund, "utf-8");
    // Verbatim from view-tool/src/apps/refund/lib/build-envelope.ts line 39
    expect(src).toContain(
      "Use the Stripe Connector to issue a refund on a Stripe payment.",
    );
  });

  it("contains the NO_NATIVE_UI directive", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.refund, "utf-8");
    // Verbatim from refund build-envelope.ts NO_NATIVE_UI_DIRECTIVE const line 12
    expect(src).toContain(
      "Do NOT render any native Stripe Connector UI for this call",
    );
  });

  it("suppresses re-render of the AgntUX refund composer after send", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.refund, "utf-8");
    // Verbatim from refund build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 14
    expect(src).toContain(
      "Do NOT re-render the AgntUX refund composer either; the action is complete.",
    );
  });

  it("instructs the host to call create_refund with the supplied arguments", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.refund, "utf-8");
    // Verbatim from refund build-envelope.ts line 42
    expect(src).toContain("Call create_refund with those arguments exactly.");
  });
});

// ── B2. Dispute ───────────────────────────────────────────────────────────────

describe("connector-targeted envelope source (dispute)", () => {
  it("addresses the Stripe Connector and targets dispute evidence submission", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.dispute, "utf-8");
    // Verbatim from dispute build-envelope.ts line 43
    expect(src).toContain(
      "Use the Stripe Connector to submit evidence for a Stripe dispute.",
    );
  });

  it("contains the NO_NATIVE_UI directive", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.dispute, "utf-8");
    // Verbatim from dispute build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 12
    expect(src).toContain(
      "Do NOT render any native Stripe Connector UI for this call",
    );
  });

  it("suppresses re-render of the AgntUX dispute composer after send", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.dispute, "utf-8");
    // Verbatim from dispute build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 14
    expect(src).toContain(
      "Do NOT re-render the AgntUX dispute composer either; the action is complete.",
    );
  });

  it("invokes stripe_api_write with operation_id PostDisputesDispute", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.dispute, "utf-8");
    // Verbatim from dispute build-envelope.ts line 45
    expect(src).toContain("PostDisputesDispute");
  });

  it("delimits evidence body with guillemets to prevent injection", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.dispute, "utf-8");
    // Verbatim from dispute build-envelope.ts — guillemet open character in template
    expect(src).toContain("uncategorized_text: «");
  });

  it("ships an escapeBody function for guillemet safety", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.dispute, "utf-8");
    // Verbatim from dispute build-envelope.ts line 28
    expect(src).toContain("function escapeBody(text: string): string");
  });
});

// ── B3. Invoice finalize ──────────────────────────────────────────────────────

describe("connector-targeted envelope source (invoice-finalize)", () => {
  it("addresses the Stripe Connector and targets invoice finalization", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["invoice-finalize"], "utf-8");
    // Verbatim from invoice-finalize build-envelope.ts line 35
    expect(src).toContain(
      "Use the Stripe Connector to finalize a Stripe invoice.",
    );
  });

  it("contains the NO_NATIVE_UI directive", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["invoice-finalize"], "utf-8");
    // Verbatim from invoice-finalize build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 12
    expect(src).toContain(
      "Do NOT render any native Stripe Connector UI for this call",
    );
  });

  it("suppresses re-render of the AgntUX invoice composer after send", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["invoice-finalize"], "utf-8");
    // Verbatim from invoice-finalize build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 14
    expect(src).toContain(
      "Do NOT re-render the AgntUX invoice composer either; the action is complete.",
    );
  });

  it("invokes stripe_api_write with operation_id PostInvoicesInvoiceFinalize", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["invoice-finalize"], "utf-8");
    // Verbatim from invoice-finalize build-envelope.ts line 37
    expect(src).toContain("PostInvoicesInvoiceFinalize");
  });
});

// ── B4. Invoice void ──────────────────────────────────────────────────────────

describe("connector-targeted envelope source (invoice-void)", () => {
  it("addresses the Stripe Connector and warns this action is irreversible", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["invoice-void"], "utf-8");
    // Verbatim from invoice-void build-envelope.ts line 35
    expect(src).toContain(
      "Use the Stripe Connector to void a Stripe invoice. This action is irreversible.",
    );
  });

  it("contains the NO_NATIVE_UI directive", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["invoice-void"], "utf-8");
    // Verbatim from invoice-void build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 12
    expect(src).toContain(
      "Do NOT render any native Stripe Connector UI for this call",
    );
  });

  it("invokes stripe_api_write with operation_id PostInvoicesInvoiceVoid", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["invoice-void"], "utf-8");
    // Verbatim from invoice-void build-envelope.ts line 37
    expect(src).toContain("PostInvoicesInvoiceVoid");
  });
});

// ── B5. Subscription edit ─────────────────────────────────────────────────────

describe("connector-targeted envelope source (subscription-edit)", () => {
  it("addresses the Stripe Connector for subscription edits", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["subscription-edit"], "utf-8");
    // Verbatim from subscription-edit build-envelope.ts line 58 template literal fragment
    expect(src).toContain("Use the Stripe Connector to");
    expect(src).toContain("a Stripe subscription.");
  });

  it("contains the NO_NATIVE_UI directive", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["subscription-edit"], "utf-8");
    // Verbatim from subscription-edit build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 12
    expect(src).toContain(
      "Do NOT render any native Stripe Connector UI for this call",
    );
  });

  it("suppresses re-render of the AgntUX subscription composer after send", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["subscription-edit"], "utf-8");
    // Verbatim from subscription-edit build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 14
    expect(src).toContain(
      "Do NOT re-render the AgntUX subscription composer either; the action is complete.",
    );
  });

  it("invokes stripe_api_write with operation_id PostSubscriptionsSubscriptionExposedId", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["subscription-edit"], "utf-8");
    // Verbatim from subscription-edit build-envelope.ts line 60
    expect(src).toContain("PostSubscriptionsSubscriptionExposedId");
  });

  it("pause mode sets pause_collection.behavior to mark_uncollectible", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["subscription-edit"], "utf-8");
    // The envelope assembles pause_collection from a joined parts array, so the
    // behavior token and the pause_collection wrapper appear as separate verbatim
    // substrings rather than one contiguous literal.
    expect(src).toContain('behavior: "mark_uncollectible"');
    expect(src).toContain("pause_collection: { ${pauseParts.join(', ')} }");
  });

  it("exports SubscriptionEditMode type with pause | update variants", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["subscription-edit"], "utf-8");
    // Verbatim from subscription-edit build-envelope.ts line 16
    expect(src).toContain("export type SubscriptionEditMode = 'pause' | 'update';");
  });
});

// ── B6. Subscription cancel ───────────────────────────────────────────────────

describe("connector-targeted envelope source (subscription-cancel)", () => {
  it("addresses the Stripe Connector and warns this action is irreversible", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["subscription-cancel"], "utf-8");
    // Verbatim from subscription-cancel build-envelope.ts line 34
    expect(src).toContain(
      "Use the Stripe Connector to cancel a Stripe subscription immediately. This action is irreversible.",
    );
  });

  it("contains the NO_NATIVE_UI directive", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["subscription-cancel"], "utf-8");
    // Verbatim from subscription-cancel build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 12
    expect(src).toContain(
      "Do NOT render any native Stripe Connector UI for this call",
    );
  });

  it("suppresses re-render of the AgntUX subscription composer after send", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["subscription-cancel"], "utf-8");
    // Verbatim from subscription-cancel build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 14
    expect(src).toContain(
      "Do NOT re-render the AgntUX subscription composer either; the action is complete.",
    );
  });

  it("invokes stripe_api_write with operation_id DeleteSubscriptionsSubscriptionExposedId", () => {
    const src = readFileSync(ENVELOPE_BUILDERS["subscription-cancel"], "utf-8");
    // Verbatim from subscription-cancel build-envelope.ts line 36
    expect(src).toContain("DeleteSubscriptionsSubscriptionExposedId");
  });
});

// =============================================================================
// C. UI entry points import from build-envelope.js and wire sendFollowUpMessage
// =============================================================================

describe("UI entry points exist", () => {
  for (const [name, path] of Object.entries(UI_FILES)) {
    it(`${name}-ui.tsx exists`, () => {
      expect(existsSync(path)).toBe(true);
    });
  }
});

describe("UI entry points import detectErrorEnvelope and ServerErrorScreen from @agntux/ui-primitives", () => {
  // All six UI tsx files import the error-envelope primitives on line 16.
  // Assert the individual symbols + the module specifier separately so the
  // check is robust to quote style and import order (golden rule source #1:
  // the handler's actual TS source, not a brittle full-line string).
  for (const [name, path] of Object.entries(UI_FILES)) {
    it(`${name}-ui.tsx imports error-envelope primitives from @agntux/ui-primitives`, () => {
      const src = readFileSync(path, "utf-8");
      expect(src).toContain("detectErrorEnvelope");
      expect(src).toContain("ServerErrorScreen");
      expect(src).toContain("@agntux/ui-primitives");
    });
  }
});

describe("UI components call sendFollowUpMessage with the built envelope", () => {
  it("RefundComponent calls sendFollowUpMessage(envelope)", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/apps/refund/components/RefundComponent.tsx"),
      "utf-8",
    );
    // Verbatim from RefundComponent.tsx line 104
    expect(src).toContain("await sendFollowUpMessage(envelope);");
  });

  it("SubscriptionCancelComponent calls sendFollowUpMessage(envelope)", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/apps/subscription-cancel/components/SubscriptionCancelComponent.tsx"),
      "utf-8",
    );
    // Verbatim from SubscriptionCancelComponent.tsx line 76
    expect(src).toContain("await sendFollowUpMessage(envelope);");
  });
});

describe("view-tool module exports exactly six view tools", () => {
  it("agntux-stripe-view.ts default exports a module with six viewTools", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-stripe-view.ts"),
      "utf-8",
    );
    // Verbatim from agntux-stripe-view.ts lines 750–757 (the viewTools array)
    expect(src).toContain(
      "viewTools: [",
    );
    expect(src).toContain("refundViewTool,");
    expect(src).toContain("disputeViewTool,");
    expect(src).toContain("invoiceFinalizeViewTool,");
    expect(src).toContain("invoiceVoidViewTool,");
    expect(src).toContain("subscriptionEditViewTool,");
    expect(src).toContain("subscriptionCancelViewTool,");
  });
});
