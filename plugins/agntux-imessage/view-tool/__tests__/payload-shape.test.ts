// =============================================================================
// payload-shape.test.ts — payload-shape regression guard for agntux-imessage.
//
// Asserts the single view tool in the module:
//   mod.viewTools[0] = agntux_imessage_reply_view
//
// Assertions are grounded in handler OUTPUT (Golden Rule #1) — the real
// structuredContent keys / byte size from calling viewTool.handle() with
// in-memory fixtures. NEVER grep prose from fetch.md / sync.md / _overrides.
//
// KEPT_KEYS are derived from the handler's ReplyPayload interface definition
// (read from agntux-imessage-view.ts before authoring this test):
//   action_id, contact_name, contact_handle, quoted_messages, draft_body,
//   personalization_signals
//
// PAYLOAD_BUDGET_BYTES = 30 KB — a single-row compose view.
//
// Pass 11 (E24/E25) of the marketplace linter verifies this file exists and
// contains a Buffer.byteLength/JSON.stringify byte-size assertion paired with
// a toBeLessThan matcher. Both conditions are met here.
//
// The handler uses extractFencedYaml(body, "Compose payload") — the action
// file fixture MUST have a fenced YAML block under a "## Compose payload"
// section header (not plain YAML fields).
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  ViewToolContext,
  ViewToolFs,
  ListWithMetaEntry,
  ViewToolScope,
} from "@agntux/plugin-runtime";
import { ViewToolFsError } from "@agntux/plugin-runtime";
import mod from "../src/agntux-imessage-view.js";

// ── Tunable knobs ─────────────────────────────────────────────────────────────

/**
 * Single-row compose view — 30 KB is a defensible upper bound even when
 * draft_body is filled with a long reply.
 */
const PAYLOAD_BUDGET_BYTES = 30 * 1024;

/**
 * structuredContent keys from the ReplyPayload interface
 * (grounded in handler source, not invented).
 */
const KEPT_KEYS = new Set([
  "action_id",
  "contact_name",
  "contact_handle",
  "quoted_messages",
  "draft_body",
  "personalization_signals",
]);

// ── In-memory fs ─────────────────────────────────────────────────────────────

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
  const fixedNow = now ?? new Date("2026-06-18T18:00:00Z");
  const ctx: ViewToolContext = {
    fs: inMemoryFs(files),
    scope: FIXED_SCOPE,
    now: () => fixedNow,
    log: () => undefined,
    withScope: () => makeCtx(files, fixedNow),
  };
  return ctx;
}

// ── Action-file builder ───────────────────────────────────────────────────────

/**
 * Build a reply action file with a fenced YAML block under "## Compose payload".
 * The handler calls extractFencedYaml(body, "Compose payload") which requires
 * this exact structure.
 */
function makeReplyActionFile(opts: {
  id: string;
  contact_name?: string;
  contact_handle?: string;
  draft_body?: string;
  quoted_messages?: Array<{ date: string; is_from_me: boolean; content: string }>;
  personalization_signals?: string[];
}): string {
  const fm = [`id: ${opts.id}`, `type: action`].join("\n");

  // Build the YAML content for the fenced block
  const qm = (
    opts.quoted_messages ?? [
      { date: "2026-06-18T18:14:30Z", is_from_me: false, content: "Are you coming to dinner Sunday?" },
    ]
  );
  const quotedLines = qm
    .map(
      (m) =>
        `  - date: "${m.date}"\n    is_from_me: ${m.is_from_me}\n    content: "${m.content}"`,
    )
    .join("\n");

  const signals = (opts.personalization_signals ?? ["direct question requiring confirmation"]);
  const signalLines = signals.map((s) => `  - "${s}"`).join("\n");

  const yamlBlock = [
    `contact_name: "${opts.contact_name ?? "Mom"}"`,
    `contact_handle: "${opts.contact_handle ?? "+14155550101"}"`,
    `quoted_messages:`,
    quotedLines,
    `draft_body: "${opts.draft_body ?? "Yes, I'll be there! What time?"}"`,
    `personalization_signals:`,
    signalLines,
  ].join("\n");

  return (
    `---\n${fm}\n---\n\n` +
    `Mom sent: "Are you coming to dinner Sunday?"\n\n` +
    `## Compose payload\n\n` +
    "```yaml\n" +
    `${yamlBlock}\n` +
    "```\n"
  );
}

// ── View tool under test ──────────────────────────────────────────────────────

const replyViewTool = mod.viewTools[0]!;

// =============================================================================
// Payload-shape regression guard
// =============================================================================

describe("agntux_imessage_reply_view payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const heavyDraft = "D".repeat(8000); // exercise long draft_body
    const files = {
      "actions/reply-budget-1.md": makeReplyActionFile({
        id: "reply-budget-1",
        draft_body: heavyDraft,
        quoted_messages: Array.from({ length: 5 }, (_, i) => ({
          date: `2026-06-18T18:1${i}:00Z`,
          is_from_me: i % 2 === 1,
          content: `Message ${i + 1} content with some text to fill it out`,
        })),
        personalization_signals: [
          "direct question requiring confirmation",
          "time-sensitive: deadline today",
          "prior outbound thread history present",
        ],
      }),
    };
    const result = await replyViewTool.handle(
      { action_id: "reply-budget-1" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    // Sanity: draft_body forwarded (proves payload is non-trivial)
    expect((sc as Record<string, unknown>).draft_body).toBe(heavyDraft);
  });

  it("returns structuredContent with exactly the KEPT_KEYS", async () => {
    const files = {
      "actions/reply-keys-1.md": makeReplyActionFile({ id: "reply-keys-1" }),
    };
    const result = await replyViewTool.handle(
      { action_id: "reply-keys-1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(
        KEPT_KEYS.has(k),
        `unexpected key "${k}" in reply structuredContent`,
      ).toBe(true);
    }
    for (const k of KEPT_KEYS) {
      expect(
        keys.has(k),
        `missing required key "${k}" in reply structuredContent`,
      ).toBe(true);
    }
  });

  it("returns sensible field values from the compose payload section", async () => {
    const files = {
      "actions/reply-values-1.md": makeReplyActionFile({
        id: "reply-values-1",
        contact_name: "Mom",
        contact_handle: "+14155550101",
        draft_body: "Yes, I'll be there! What time?",
        quoted_messages: [
          {
            date: "2026-06-18T18:14:30Z",
            is_from_me: false,
            content: "Are you coming to dinner Sunday? Need to know by tonight!",
          },
        ],
        personalization_signals: [
          "direct question requiring confirmation",
          "time-sensitive: deadline today",
        ],
      }),
    };
    const result = await replyViewTool.handle(
      { action_id: "reply-values-1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("reply-values-1");
    expect(sc.contact_name).toBe("Mom");
    expect(sc.contact_handle).toBe("+14155550101");
    expect(sc.draft_body).toBe("Yes, I'll be there! What time?");
    expect(Array.isArray(sc.quoted_messages)).toBe(true);
    expect((sc.quoted_messages as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(sc.personalization_signals)).toBe(true);
    expect((sc.personalization_signals as string[]).length).toBeGreaterThan(0);
  });

  it("quoted_messages entries have content, date, and is_from_me fields", async () => {
    const files = {
      "actions/reply-qm-1.md": makeReplyActionFile({
        id: "reply-qm-1",
        quoted_messages: [
          { date: "2026-06-18T18:14:30Z", is_from_me: false, content: "Inbound message" },
          { date: "2026-06-18T18:00:00Z", is_from_me: true, content: "Prior reply" },
        ],
      }),
    };
    const result = await replyViewTool.handle(
      { action_id: "reply-qm-1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const qm = sc.quoted_messages as Array<Record<string, unknown>>;
    expect(qm.length).toBe(2);
    for (const msg of qm) {
      expect(typeof msg.content).toBe("string");
      expect(typeof msg.date).toBe("string");
      expect(typeof msg.is_from_me).toBe("boolean");
    }
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await replyViewTool.handle(
      { action_id: "does-not-exist" },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    // Fallback must include the action_id echo
    expect(sc.action_id).toBe("does-not-exist");
    // Arrays must be empty (not undefined) in the fallback
    expect(Array.isArray(sc.quoted_messages)).toBe(true);
    expect(Array.isArray(sc.personalization_signals)).toBe(true);
  });
});

// =============================================================================
// Render-harness contract
// =============================================================================

describe("agntux_imessage_reply_view render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await replyViewTool.handle(
      {} as { action_id: string },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(
        KEPT_KEYS.has(k),
        `unexpected key "${k}" in reply placeholder`,
      ).toBe(true);
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("degrades to a placeholder when ctx.fs throws a non-ViewToolFsError", async () => {
    const ctx = makeCtx({});
    ctx.fs.readFile = async () => {
      throw new Error("boom: backend unavailable");
    };
    const result = await replyViewTool.handle(
      { action_id: "anything" },
      ctx,
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("degrades gracefully when the compose payload section is absent from the action body", async () => {
    const files = {
      "actions/no-compose.md":
        "---\nid: no-compose\ntype: action\n---\n\nSome body text with no compose payload section.\n",
    };
    const result = await replyViewTool.handle(
      { action_id: "no-compose" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    // The handler returns the partial placeholder when cp is null
    expect(sc.action_id).toBe("no-compose");
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });
});

// =============================================================================
// Response envelope guard
// =============================================================================

describe("agntux_imessage_reply_view response envelope guard", () => {
  function assertEnvelope(content: unknown) {
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0].type).toBe("text");
    const text = content[0].text as string;
    // Frozen anchor strings from @agntux/plugin-runtime render-confirmation.ts
    expect(text).toContain("iframe");
    expect(text).toContain("host");
    expect(text).toContain("MCP App");
  }

  it("success path ships the canonical content[] explanation", async () => {
    const files = {
      "actions/env-r1.md": makeReplyActionFile({ id: "env-r1" }),
    };
    const result = await replyViewTool.handle(
      { action_id: "env-r1" },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });

  it("missing-file error branch also ships the canonical content[] explanation", async () => {
    const result = await replyViewTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    assertEnvelope(result.content);
  });

  it("empty-args cold render ships the canonical content[] explanation", async () => {
    const result = await replyViewTool.handle(
      {} as { action_id: string },
      makeCtx({}),
    );
    assertEnvelope(result.content);
  });
});

// =============================================================================
// Descriptor contract
// =============================================================================

describe("view tool descriptor", () => {
  it("tool name is agntux_imessage_reply_view (matches listing.yaml view_tool)", () => {
    // Verbatim from agntux-imessage-view.ts descriptor.name
    expect(replyViewTool.descriptor.name).toBe("agntux_imessage_reply_view");
  });

  it("resource URI matches listing.yaml ui_components[0].resource_uri", () => {
    // Verbatim from agntux-imessage-view.ts RESOURCE_URI constant
    expect(replyViewTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-imessage/reply",
    );
  });

  it("outputSchema requires exactly the KEPT_KEYS", () => {
    const schema = replyViewTool.descriptor.outputSchema as {
      required: string[];
    };
    const required = new Set(schema.required);
    for (const k of KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(
        true,
      );
    }
    expect(schema.required.length).toBe(KEPT_KEYS.size);
  });

  it("inputSchema requires action_id", () => {
    const schema = replyViewTool.descriptor.inputSchema as {
      required: string[];
    };
    expect(schema.required).toContain("action_id");
  });

  it("module exports exactly 1 view tool", () => {
    expect(mod.viewTools).toHaveLength(1);
  });
});
