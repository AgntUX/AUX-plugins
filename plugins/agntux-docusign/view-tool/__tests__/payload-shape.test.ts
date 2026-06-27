// payload-shape.test.ts — agntux-docusign (view-tool)
//
// Canonical byte-budget + frozen-keyset guard.
//
// Asserts that each handler's structuredContent payload:
//   1. Contains exactly the keys declared in the handler's outputSchema.
//   2. Stays within the PAYLOAD_BUDGET_BYTES byte limit (prevents bloat).
//   3. Typed fields match their declared JSON-Schema types.
//
// All KEPT_KEYS sets and PAYLOAD_BUDGET_BYTES values are derived from the
// ACTUAL handler source (agntux-docusign-view.ts outputSchema + emptyPayload
// shapes) — not from spec docs or invented values.
//
// The test calls viewTool.handle(args, ctx) with an in-memory fixture so
// it exercises the real handler code path. @agntux/plugin-runtime is mocked
// minimally — only what the handler actually calls.

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @agntux/plugin-runtime
//
// The handlers call: parseFrontmatter, extractSection, renderConfirmationText.
// We provide lightweight pure-function stubs that correctly model the real
// contract these helpers have.
// ---------------------------------------------------------------------------

vi.mock("@agntux/plugin-runtime", () => {
  /**
   * parseFrontmatter — splits "---\n{yaml}\n---\n{body}" into parts.
   * Returns { frontmatter: Record<string,unknown>, body: string }.
   */
  function parseFrontmatter(text: string): {
    frontmatter: Record<string, unknown>;
    body: string | undefined;
  } {
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!fmMatch) {
      return { frontmatter: {}, body: text };
    }
    const yamlLines = fmMatch[1].split("\n");
    const frontmatter: Record<string, unknown> = {};
    for (const line of yamlLines) {
      const m = line.match(/^(\w+):\s*(.*)/);
      if (m) {
        const val = m[2].trim();
        // Parse numeric values
        const numVal = Number(val);
        frontmatter[m[1]] = isNaN(numVal) || val === "" ? val : numVal;
      }
    }
    return { frontmatter, body: fmMatch[2] };
  }

  /**
   * extractSection — returns the content of the first "## {heading}" section,
   * up to the next "## " heading or end of string.
   */
  function extractSection(body: string, heading: string): string {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `## ${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`,
    );
    const m = body.match(re);
    return m ? m[1].trimEnd() : "";
  }

  function renderConfirmationText(label: string): string {
    return `[${label}]`;
  }

  return { parseFrontmatter, extractSection, renderConfirmationText };
});

// ---------------------------------------------------------------------------
// Import the view-tool module under test (after mocks are set up)
// ---------------------------------------------------------------------------

import mod from "../src/agntux-docusign-view.js";

// ---------------------------------------------------------------------------
// Build a minimal ViewToolContext with an in-memory fs
// ---------------------------------------------------------------------------

function makeCtx(files: Record<string, string>) {
  return {
    fs: {
      readFile: async (path: string) => {
        const content = files[path];
        if (content === undefined) {
          throw new Error(`ENOENT: no such file: ${path}`);
        }
        return Buffer.from(content, "utf8");
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Reminder action fixture — has all frontmatter fields + body sections
 * that the handler reads.
 */
const REMINDER_ACTION_MD = `---
account_id: acc-001
envelope_id: env-aaa
envelope_subject: NDA for Q3 Partnership
envelope_url: https://app.docusign.com/documents/details/env-aaa
sent_date: 2026-06-20
days_outstanding: 6
---
## Why this matters

The NDA has been outstanding for 6 days with two pending signers.

## Pending recipients

Alice Doe | alice@example.com | sent
Bob Smith | bob@corp.example | delivered

## Draft message

Hi team, just a quick follow-up on the NDA. Please sign when you get a moment.
`;

/**
 * Void action fixture — has all frontmatter fields + body sections
 * that the handler reads.
 */
const VOID_ACTION_MD = `---
account_id: acc-001
envelope_id: env-bbb
envelope_subject: Software License Agreement
envelope_url: https://app.docusign.com/documents/details/env-bbb
sent_date: 2026-06-15
recipient_count: 3
---
## Why this matters

The contract terms changed; the envelope needs to be voided.

## Draft void reason

The contract terms have changed since this envelope was sent. A revised version will follow.
`;

/**
 * Sign action fixture — frontmatter only (no body sections needed).
 */
const SIGN_ACTION_MD = `---
envelope_id: env-ccc
envelope_subject: Consulting Agreement
sender_name: Jane Manager
sent_date: 2026-06-22
expiration_date: 2026-07-22
signer_position: Signer 1 of 2
signing_url: https://docusign.net/Member/PowerFormSigning.aspx?token=abc
---
## Why this matters

You are signer 1 of 2 on this consulting agreement.
`;

// ---------------------------------------------------------------------------
// Locate handlers by tool name
// ---------------------------------------------------------------------------

const reminderTool = mod.viewTools.find(
  (t) => t.descriptor.name === "agntux_docusign_reminder_view",
)!;
const voidTool = mod.viewTools.find(
  (t) => t.descriptor.name === "agntux_docusign_void_view",
)!;
const signTool = mod.viewTools.find(
  (t) => t.descriptor.name === "agntux_docusign_sign_view",
)!;

// ---------------------------------------------------------------------------
// Payload budget (bytes) — derived from handler emptyPayload + typical fixture
// content. Set conservatively: the reminder payload is the largest (has
// pending_recipients array). Budgets are generous to avoid brittleness while
// still catching accidental unbounded growth.
// ---------------------------------------------------------------------------

// Reminder: 8 scalar fields + pending_recipients array. With 5 recipients
// at ~80 bytes each and ~200 bytes of scalar overhead = ~600 bytes headroom.
const REMINDER_PAYLOAD_BUDGET_BYTES = 2048;

// Void: 7 scalar fields, no arrays. Smaller.
const VOID_PAYLOAD_BUDGET_BYTES = 512;

// Sign: 7 scalar fields, no arrays.
const SIGN_PAYLOAD_BUDGET_BYTES = 512;

// ---------------------------------------------------------------------------
// Frozen keyset — exactly the outputSchema required keys for each handler.
// Derived verbatim from agntux-docusign-view.ts outputSchema.required arrays.
// ---------------------------------------------------------------------------

const REMINDER_KEPT_KEYS = new Set([
  "account_id",
  "envelope_id",
  "envelope_subject",
  "envelope_url",
  "sent_date",
  "days_outstanding",
  "pending_recipients",
  "draft_message",
]);

const VOID_KEPT_KEYS = new Set([
  "account_id",
  "envelope_id",
  "envelope_subject",
  "envelope_url",
  "sent_date",
  "recipient_count",
  "draft_void_reason",
]);

const SIGN_KEPT_KEYS = new Set([
  "envelope_id",
  "envelope_subject",
  "sender_name",
  "sent_date",
  "expiration_date",
  "signer_position",
  "signing_url",
]);

// ---------------------------------------------------------------------------
// Helper: assert payload keyset and budget
// ---------------------------------------------------------------------------

function assertPayloadShape(
  payload: Record<string, unknown>,
  keptKeys: Set<string>,
  budgetBytes: number,
  label: string,
) {
  const actualKeys = new Set(Object.keys(payload));

  // Frozen keyset: no extra keys, no missing keys
  for (const key of keptKeys) {
    expect(actualKeys.has(key), `${label}: missing key "${key}"`).toBe(true);
  }
  for (const key of actualKeys) {
    expect(keptKeys.has(key), `${label}: unexpected key "${key}"`).toBe(true);
  }

  // Byte budget
  const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
  expect(size, `${label}: payload exceeds ${budgetBytes} bytes (got ${size})`).toBeLessThanOrEqual(
    budgetBytes,
  );
}

// ---------------------------------------------------------------------------
// Tests: reminder handler
// ---------------------------------------------------------------------------

describe("agntux_docusign_reminder_view handler", () => {
  it("returns exact keyset from outputSchema.required when action file is found", async () => {
    const ctx = makeCtx({ "actions/action-001.md": REMINDER_ACTION_MD });
    const result = await reminderTool.handle(
      { action_id: "action-001" },
      ctx as never,
    );
    const payload = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(payload, REMINDER_KEPT_KEYS, REMINDER_PAYLOAD_BUDGET_BYTES, "reminder");
  });

  it("populates account_id and envelope_id from frontmatter", async () => {
    const ctx = makeCtx({ "actions/action-001.md": REMINDER_ACTION_MD });
    const result = await reminderTool.handle(
      { action_id: "action-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.account_id).toBe("acc-001");
    expect(p.envelope_id).toBe("env-aaa");
  });

  it("populates envelope_subject from frontmatter", async () => {
    const ctx = makeCtx({ "actions/action-001.md": REMINDER_ACTION_MD });
    const result = await reminderTool.handle(
      { action_id: "action-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.envelope_subject).toBe("NDA for Q3 Partnership");
  });

  it("days_outstanding is a number", async () => {
    const ctx = makeCtx({ "actions/action-001.md": REMINDER_ACTION_MD });
    const result = await reminderTool.handle(
      { action_id: "action-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(typeof p.days_outstanding).toBe("number");
    expect(p.days_outstanding).toBe(6);
  });

  it("pending_recipients is an array with parsed signer entries", async () => {
    const ctx = makeCtx({ "actions/action-001.md": REMINDER_ACTION_MD });
    const result = await reminderTool.handle(
      { action_id: "action-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    const recipients = p.pending_recipients as Array<{
      name: string;
      email: string;
      status: string;
    }>;
    expect(Array.isArray(recipients)).toBe(true);
    expect(recipients).toHaveLength(2);
    expect(recipients[0].name).toBe("Alice Doe");
    expect(recipients[0].email).toBe("alice@example.com");
    expect(recipients[0].status).toBe("sent");
    expect(recipients[1].name).toBe("Bob Smith");
    expect(recipients[1].status).toBe("delivered");
  });

  it("draft_message is seeded from ## Draft message body section", async () => {
    const ctx = makeCtx({ "actions/action-001.md": REMINDER_ACTION_MD });
    const result = await reminderTool.handle(
      { action_id: "action-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(typeof p.draft_message).toBe("string");
    expect((p.draft_message as string).length).toBeGreaterThan(0);
    expect(p.draft_message as string).toContain("follow-up on the NDA");
  });

  it("returns emptyPayload (envelope_id=actionId) when action file is missing", async () => {
    const ctx = makeCtx({});
    const result = await reminderTool.handle(
      { action_id: "nonexistent" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(p, REMINDER_KEPT_KEYS, REMINDER_PAYLOAD_BUDGET_BYTES, "reminder-missing");
    expect(p.envelope_id).toBe("nonexistent");
    expect(p.account_id).toBe("");
    expect(Array.isArray(p.pending_recipients)).toBe(true);
    expect((p.pending_recipients as unknown[]).length).toBe(0);
  });

  it("returns emptyPayload when action_id is empty string", async () => {
    const ctx = makeCtx({});
    const result = await reminderTool.handle({ action_id: "" }, ctx as never);
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(p, REMINDER_KEPT_KEYS, REMINDER_PAYLOAD_BUDGET_BYTES, "reminder-empty-id");
    expect(p.envelope_id).toBe("");
  });

  it("content[0].type is 'text'", async () => {
    const ctx = makeCtx({ "actions/action-001.md": REMINDER_ACTION_MD });
    const result = await reminderTool.handle(
      { action_id: "action-001" },
      ctx as never,
    );
    expect(result.content[0].type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Tests: void handler
// ---------------------------------------------------------------------------

describe("agntux_docusign_void_view handler", () => {
  it("returns exact keyset from outputSchema.required when action file is found", async () => {
    const ctx = makeCtx({ "actions/action-002.md": VOID_ACTION_MD });
    const result = await voidTool.handle(
      { action_id: "action-002" },
      ctx as never,
    );
    const payload = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(payload, VOID_KEPT_KEYS, VOID_PAYLOAD_BUDGET_BYTES, "void");
  });

  it("populates account_id and envelope_id from frontmatter", async () => {
    const ctx = makeCtx({ "actions/action-002.md": VOID_ACTION_MD });
    const result = await voidTool.handle(
      { action_id: "action-002" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.account_id).toBe("acc-001");
    expect(p.envelope_id).toBe("env-bbb");
  });

  it("recipient_count is a number", async () => {
    const ctx = makeCtx({ "actions/action-002.md": VOID_ACTION_MD });
    const result = await voidTool.handle(
      { action_id: "action-002" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(typeof p.recipient_count).toBe("number");
    expect(p.recipient_count).toBe(3);
  });

  it("draft_void_reason is seeded from ## Draft void reason body section", async () => {
    const ctx = makeCtx({ "actions/action-002.md": VOID_ACTION_MD });
    const result = await voidTool.handle(
      { action_id: "action-002" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(typeof p.draft_void_reason).toBe("string");
    expect(p.draft_void_reason as string).toContain("contract terms have changed");
  });

  it("returns emptyPayload (envelope_id=actionId) when action file is missing", async () => {
    const ctx = makeCtx({});
    const result = await voidTool.handle(
      { action_id: "missing-action" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(p, VOID_KEPT_KEYS, VOID_PAYLOAD_BUDGET_BYTES, "void-missing");
    expect(p.envelope_id).toBe("missing-action");
    expect(p.draft_void_reason).toBe("");
  });

  it("returns emptyPayload when action_id is empty string", async () => {
    const ctx = makeCtx({});
    const result = await voidTool.handle({ action_id: "" }, ctx as never);
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(p, VOID_KEPT_KEYS, VOID_PAYLOAD_BUDGET_BYTES, "void-empty-id");
    expect(p.recipient_count).toBe(0);
  });

  it("content[0].type is 'text'", async () => {
    const ctx = makeCtx({ "actions/action-002.md": VOID_ACTION_MD });
    const result = await voidTool.handle(
      { action_id: "action-002" },
      ctx as never,
    );
    expect(result.content[0].type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Tests: sign handler (open-in / read-only)
// ---------------------------------------------------------------------------

describe("agntux_docusign_sign_view handler", () => {
  it("returns exact keyset from outputSchema.required when action file is found", async () => {
    const ctx = makeCtx({ "actions/action-003.md": SIGN_ACTION_MD });
    const result = await signTool.handle(
      { action_id: "action-003" },
      ctx as never,
    );
    const payload = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(payload, SIGN_KEPT_KEYS, SIGN_PAYLOAD_BUDGET_BYTES, "sign");
  });

  it("populates all scalar fields from frontmatter", async () => {
    const ctx = makeCtx({ "actions/action-003.md": SIGN_ACTION_MD });
    const result = await signTool.handle(
      { action_id: "action-003" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.envelope_id).toBe("env-ccc");
    expect(p.envelope_subject).toBe("Consulting Agreement");
    expect(p.sender_name).toBe("Jane Manager");
    expect(p.sent_date).toBe("2026-06-22");
    expect(p.expiration_date).toBe("2026-07-22");
    expect(p.signer_position).toBe("Signer 1 of 2");
    expect(p.signing_url).toContain("docusign.net");
  });

  it("does NOT include account_id in payload (sign is open-in, no write)", async () => {
    const ctx = makeCtx({ "actions/action-003.md": SIGN_ACTION_MD });
    const result = await signTool.handle(
      { action_id: "action-003" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    // Sign payload has no account_id — it is not in the outputSchema.
    expect("account_id" in p).toBe(false);
  });

  it("does NOT include pending_recipients or draft fields (sign is read-only)", async () => {
    const ctx = makeCtx({ "actions/action-003.md": SIGN_ACTION_MD });
    const result = await signTool.handle(
      { action_id: "action-003" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect("pending_recipients" in p).toBe(false);
    expect("draft_message" in p).toBe(false);
    expect("draft_void_reason" in p).toBe(false);
  });

  it("returns emptyPayload (envelope_id=actionId) when action file is missing", async () => {
    const ctx = makeCtx({});
    const result = await signTool.handle(
      { action_id: "missing-sign" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(p, SIGN_KEPT_KEYS, SIGN_PAYLOAD_BUDGET_BYTES, "sign-missing");
    expect(p.envelope_id).toBe("missing-sign");
    expect(p.signing_url).toBe("");
  });

  it("returns emptyPayload when action_id is empty string", async () => {
    const ctx = makeCtx({});
    const result = await signTool.handle({ action_id: "" }, ctx as never);
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(p, SIGN_KEPT_KEYS, SIGN_PAYLOAD_BUDGET_BYTES, "sign-empty-id");
    expect(p.envelope_id).toBe("");
    expect(p.signer_position).toBe("");
  });

  it("content[0].type is 'text'", async () => {
    const ctx = makeCtx({ "actions/action-003.md": SIGN_ACTION_MD });
    const result = await signTool.handle(
      { action_id: "action-003" },
      ctx as never,
    );
    expect(result.content[0].type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Module shape — three tools exported, correct resource URIs
// ---------------------------------------------------------------------------

describe("view-tool module shape", () => {
  it("exports exactly three viewTools", () => {
    // Verbatim from agntux-docusign-view.ts: viewTools: [reminderViewTool, voidViewTool, signViewTool]
    expect(mod.viewTools).toHaveLength(3);
  });

  it("reminder tool ui_resource_uri matches listing.yaml", () => {
    // Verbatim from agntux-docusign-view.ts: "ui://agntux-docusign/reminder"
    expect(reminderTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-docusign/reminder",
    );
  });

  it("void tool ui_resource_uri matches listing.yaml", () => {
    // Verbatim from agntux-docusign-view.ts: "ui://agntux-docusign/void"
    expect(voidTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-docusign/void",
    );
  });

  it("sign tool ui_resource_uri matches listing.yaml", () => {
    // Verbatim from agntux-docusign-view.ts: "ui://agntux-docusign/sign"
    expect(signTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-docusign/sign",
    );
  });

  it("all tools have data_paths scoped to personal", () => {
    for (const tool of mod.viewTools) {
      // Verbatim from agntux-docusign-view.ts:
      // data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
      expect(tool.descriptor.data_paths?.[0]?.scope).toBe("personal");
      expect(tool.descriptor.data_paths?.[0]?.pattern).toBe("actions/{id}.md");
    }
  });

  it("reminder and void tools have action_id as required inputSchema property", () => {
    for (const tool of [reminderTool, voidTool, signTool]) {
      const schema = tool.descriptor.inputSchema;
      expect((schema as Record<string, unknown>).required).toContain("action_id");
    }
  });
});
