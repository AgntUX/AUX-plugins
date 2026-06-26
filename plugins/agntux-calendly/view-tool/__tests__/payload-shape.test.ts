/**
 * payload-shape.test.ts — agntux-calendly view-tool
 *
 * Lint-pass-11 E24/E25 guard: frozen-keyset and byte-budget assertions for
 * all three view-tool handlers.
 *
 * Calls viewTool.handle(args, ctx) with an in-memory fixture and asserts
 * the real structuredContent keyset and approximate payload byte size.
 *
 * Byte-budget caps (E24): the structuredContent JSON must stay under 64 KiB
 * per tool call (the remote MCP server's response budget). The caps below
 * are tuned to each handler's actual shape; an invitees[] array at the
 * no-show handler is the only variable-length field.
 *
 * Frozen-keyset guard (E25): adding or removing a top-level key from
 * structuredContent is a breaking change for the UI component and must be
 * caught here.
 *
 * GOLDEN RULE: KEPT_KEYS and expected values are derived from reading
 * view-tool/src/agntux-calendly-view.ts — the handler's TypeScript
 * interfaces and the empty/populated paths. No prose-grep anywhere.
 *
 * Handler structuredContent keys (from agntux-calendly-view.ts):
 *   cancel:          meeting_url, event_uri, meeting_name, invitee_name,
 *                    start_time_utc, draft_reason
 *   no-show:         meeting_url, meeting_name, start_time_utc, invitees
 *   scheduling-link: event_types, host_scheduling_url
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Inline stub for ViewToolContext — the handler only uses ctx for data_paths
// reads (which the inline-args path skips entirely). A minimal stub suffices.
// ---------------------------------------------------------------------------
const CTX = {
  readFile: async () => null,
  listFiles: async () => [],
  userEmail: "trish@agntux.ai",
} as unknown as import("@agntux/plugin-runtime").ViewToolContext;

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
import viewToolModule from "../src/agntux-calendly-view.js";

function getHandler(name: string) {
  const tool = viewToolModule.viewTools.find((t) => t.descriptor.name === name);
  if (!tool) throw new Error(`Handler not found: ${name}`);
  return tool;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAYLOAD_BUDGET_BYTES = 65_536; // 64 KiB

function byteSize(obj: unknown): number {
  return Buffer.byteLength(JSON.stringify(obj), "utf-8");
}

// ---------------------------------------------------------------------------
// Handler: agntux_calendly_cancel
// ---------------------------------------------------------------------------

describe("agntux_calendly_cancel — structuredContent shape", () => {
  const CANCEL_KEYS = [
    "meeting_url",
    "event_uri",
    "meeting_name",
    "invitee_name",
    "start_time_utc",
    "draft_reason",
  ];

  it("empty-args call returns all 6 required keys with empty-string values", async () => {
    const handler = getHandler("agntux_calendly_cancel");
    const result = await handler.handle({}, CTX);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Object.keys(sc).sort()).toEqual(CANCEL_KEYS.slice().sort());
    for (const key of CANCEL_KEYS) {
      expect(sc[key]).toBe("");
    }
  });

  it("populated-args call returns provided values verbatim", async () => {
    const handler = getHandler("agntux_calendly_cancel");
    const args = {
      meeting_url: "https://calendly.com/trish/30min/abc123",
      event_uri: "https://api.calendly.com/scheduled_events/abc123",
      meeting_name: "30 Minute Meeting",
      invitee_name: "Alice Smith",
      start_time_utc: "2026-06-25T14:00:00Z",
      draft_reason: "I need to reschedule due to a conflict.",
    };
    const result = await handler.handle(args, CTX);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.meeting_url).toBe(args.meeting_url);
    expect(sc.event_uri).toBe(args.event_uri);
    expect(sc.meeting_name).toBe(args.meeting_name);
    expect(sc.invitee_name).toBe(args.invitee_name);
    expect(sc.start_time_utc).toBe(args.start_time_utc);
    expect(sc.draft_reason).toBe(args.draft_reason);
  });

  it("structuredContent keyset is frozen — no extra or missing keys", async () => {
    const handler = getHandler("agntux_calendly_cancel");
    const result = await handler.handle(
      { event_uri: "https://api.calendly.com/scheduled_events/abc123" },
      CTX,
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Object.keys(sc).sort()).toEqual(CANCEL_KEYS.slice().sort());
  });

  it("payload is within the 64 KiB byte budget (E24)", async () => {
    const handler = getHandler("agntux_calendly_cancel");
    const result = await handler.handle(
      {
        meeting_url: "https://calendly.com/trish/30min/abc123",
        event_uri: "https://api.calendly.com/scheduled_events/abc123",
        meeting_name: "30 Minute Meeting",
        invitee_name: "Alice Smith",
        start_time_utc: "2026-06-25T14:00:00Z",
        draft_reason: "I need to reschedule.",
      },
      CTX,
    );
    expect(byteSize(result.structuredContent)).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("never throws — render-harness contract", async () => {
    const handler = getHandler("agntux_calendly_cancel");
    await expect(handler.handle({}, CTX)).resolves.toBeDefined();
    await expect(handler.handle({ event_uri: "" }, CTX)).resolves.toBeDefined();
  });

  it("content[0].type is text", async () => {
    const handler = getHandler("agntux_calendly_cancel");
    const result = await handler.handle({}, CTX);
    expect(result.content[0].type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Handler: agntux_calendly_no_show
// ---------------------------------------------------------------------------

describe("agntux_calendly_no_show — structuredContent shape", () => {
  const NO_SHOW_KEYS = ["meeting_url", "meeting_name", "start_time_utc", "invitees"];

  it("empty-args call returns all 4 required keys — invitees is an empty array", async () => {
    const handler = getHandler("agntux_calendly_no_show");
    const result = await handler.handle({}, CTX);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Object.keys(sc).sort()).toEqual(NO_SHOW_KEYS.slice().sort());
    expect(sc.meeting_url).toBe("");
    expect(sc.meeting_name).toBe("");
    expect(sc.start_time_utc).toBe("");
    expect(Array.isArray(sc.invitees)).toBe(true);
    expect((sc.invitees as unknown[]).length).toBe(0);
  });

  it("populated-args call populates invitees array with parsed entries", async () => {
    const handler = getHandler("agntux_calendly_no_show");
    const args = {
      meeting_name: "Discovery Call",
      meeting_url: "https://calendly.com/trish/discovery/xyz789",
      start_time_utc: "2026-06-20T09:00:00Z",
      invitees: [
        {
          invitee_uri: "https://api.calendly.com/invitees/inv001",
          name: "Bob Jones",
          email: "bob@example.com",
          is_guest: false,
        },
      ],
    };
    const result = await handler.handle(args, CTX);
    const sc = result.structuredContent as Record<string, unknown>;
    const invitees = sc.invitees as Array<Record<string, unknown>>;
    expect(invitees.length).toBe(1);
    expect(invitees[0].invitee_uri).toBe(
      "https://api.calendly.com/invitees/inv001",
    );
    expect(invitees[0].name).toBe("Bob Jones");
    expect(invitees[0].email).toBe("bob@example.com");
    expect(invitees[0].is_guest).toBe(false);
  });

  it("invitee entries without invitee_uri are filtered out", async () => {
    const handler = getHandler("agntux_calendly_no_show");
    const args = {
      meeting_name: "Call",
      invitees: [
        { name: "No URI Person", email: "nouri@example.com", is_guest: false },
        {
          invitee_uri: "https://api.calendly.com/invitees/inv002",
          name: "Valid Person",
          email: "valid@example.com",
          is_guest: false,
        },
      ],
    };
    const result = await handler.handle(args, CTX);
    const sc = result.structuredContent as Record<string, unknown>;
    const invitees = sc.invitees as Array<Record<string, unknown>>;
    expect(invitees.length).toBe(1);
    expect(invitees[0].name).toBe("Valid Person");
  });

  it("structuredContent keyset is frozen — exactly 4 top-level keys", async () => {
    const handler = getHandler("agntux_calendly_no_show");
    const result = await handler.handle(
      { meeting_name: "Test Call" },
      CTX,
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Object.keys(sc).sort()).toEqual(NO_SHOW_KEYS.slice().sort());
  });

  it("payload with 10 invitees is within the 64 KiB byte budget (E24)", async () => {
    const handler = getHandler("agntux_calendly_no_show");
    const invitees = Array.from({ length: 10 }, (_, i) => ({
      invitee_uri: `https://api.calendly.com/invitees/inv${String(i).padStart(3, "0")}`,
      name: `Attendee ${i}`,
      email: `attendee${i}@example.com`,
      is_guest: false,
    }));
    const result = await handler.handle(
      {
        meeting_name: "Team Sync",
        meeting_url: "https://calendly.com/trish/team-sync/abc",
        start_time_utc: "2026-06-20T15:00:00Z",
        invitees,
      },
      CTX,
    );
    expect(byteSize(result.structuredContent)).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("never throws — render-harness contract", async () => {
    const handler = getHandler("agntux_calendly_no_show");
    await expect(handler.handle({}, CTX)).resolves.toBeDefined();
    await expect(handler.handle({ invitees: null }, CTX)).resolves.toBeDefined();
    await expect(handler.handle({ invitees: "not-an-array" }, CTX)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Handler: agntux_calendly_scheduling_link
// ---------------------------------------------------------------------------

describe("agntux_calendly_scheduling_link — structuredContent shape", () => {
  const SCHEDULING_LINK_KEYS = ["event_types", "host_scheduling_url"];

  it("empty-args call returns both required keys — event_types is an empty array", async () => {
    const handler = getHandler("agntux_calendly_scheduling_link");
    const result = await handler.handle({}, CTX);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Object.keys(sc).sort()).toEqual(SCHEDULING_LINK_KEYS.slice().sort());
    expect(Array.isArray(sc.event_types)).toBe(true);
    expect((sc.event_types as unknown[]).length).toBe(0);
    expect(sc.host_scheduling_url).toBe("");
  });

  it("populated-args call parses event_types array", async () => {
    const handler = getHandler("agntux_calendly_scheduling_link");
    const args = {
      host_scheduling_url: "https://calendly.com/trish",
      event_types: [
        {
          event_type_uri: "https://api.calendly.com/event_types/etype001",
          name: "30 Minute Meeting",
          duration_minutes: 30,
          scheduling_url: "https://calendly.com/trish/30min",
        },
        {
          event_type_uri: "https://api.calendly.com/event_types/etype002",
          name: "60 Minute Consulting",
          duration_minutes: 60,
          scheduling_url: "https://calendly.com/trish/60min",
        },
      ],
    };
    const result = await handler.handle(args, CTX);
    const sc = result.structuredContent as Record<string, unknown>;
    const types = sc.event_types as Array<Record<string, unknown>>;
    expect(types.length).toBe(2);
    expect(types[0].event_type_uri).toBe(
      "https://api.calendly.com/event_types/etype001",
    );
    expect(types[0].name).toBe("30 Minute Meeting");
    expect(types[0].duration_minutes).toBe(30);
    expect(types[0].scheduling_url).toBe("https://calendly.com/trish/30min");
    expect(sc.host_scheduling_url).toBe("https://calendly.com/trish");
  });

  it("event_type entries without event_type_uri are filtered out", async () => {
    const handler = getHandler("agntux_calendly_scheduling_link");
    const args = {
      event_types: [
        { name: "No URI Type", duration_minutes: 15, scheduling_url: "https://calendly.com/x" },
        {
          event_type_uri: "https://api.calendly.com/event_types/etype003",
          name: "Valid Type",
          duration_minutes: 45,
          scheduling_url: "https://calendly.com/trish/45min",
        },
      ],
    };
    const result = await handler.handle(args, CTX);
    const sc = result.structuredContent as Record<string, unknown>;
    const types = sc.event_types as Array<Record<string, unknown>>;
    expect(types.length).toBe(1);
    expect(types[0].name).toBe("Valid Type");
  });

  it("structuredContent keyset is frozen — exactly 2 top-level keys", async () => {
    const handler = getHandler("agntux_calendly_scheduling_link");
    const result = await handler.handle(
      { host_scheduling_url: "https://calendly.com/trish" },
      CTX,
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Object.keys(sc).sort()).toEqual(SCHEDULING_LINK_KEYS.slice().sort());
  });

  it("payload with 20 event types is within the 64 KiB byte budget (E24)", async () => {
    const handler = getHandler("agntux_calendly_scheduling_link");
    const event_types = Array.from({ length: 20 }, (_, i) => ({
      event_type_uri: `https://api.calendly.com/event_types/etype${String(i).padStart(3, "0")}`,
      name: `Event Type ${i} with a somewhat long descriptive name`,
      duration_minutes: 30 + i * 5,
      scheduling_url: `https://calendly.com/trish/event-type-${i}`,
    }));
    const result = await handler.handle(
      { host_scheduling_url: "https://calendly.com/trish", event_types },
      CTX,
    );
    expect(byteSize(result.structuredContent)).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("never throws — render-harness contract", async () => {
    const handler = getHandler("agntux_calendly_scheduling_link");
    await expect(handler.handle({}, CTX)).resolves.toBeDefined();
    await expect(handler.handle({ event_types: null }, CTX)).resolves.toBeDefined();
    await expect(handler.handle({ event_types: 42 }, CTX)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Module-level invariants — all three handlers registered
// ---------------------------------------------------------------------------

describe("view-tool module", () => {
  it("exports exactly 3 view tools", () => {
    expect(viewToolModule.viewTools.length).toBe(3);
  });

  it("tool names are agntux_calendly_cancel, agntux_calendly_no_show, agntux_calendly_scheduling_link", () => {
    const names = viewToolModule.viewTools.map((t) => t.descriptor.name).sort();
    expect(names).toEqual([
      "agntux_calendly_cancel",
      "agntux_calendly_no_show",
      "agntux_calendly_scheduling_link",
    ]);
  });

  it("each tool descriptor has a ui_resource_uri", () => {
    for (const tool of viewToolModule.viewTools) {
      expect(tool.descriptor.ui_resource_uri).toBeTruthy();
    }
  });

  it("cancel tool ui_resource_uri is ui://agntux-calendly/cancel", () => {
    const t = getHandler("agntux_calendly_cancel");
    // Verbatim from agntux-calendly-view.ts line 30:
    // 'const CANCEL_RESOURCE_URI = "ui://agntux-calendly/cancel" as const;'
    expect(t.descriptor.ui_resource_uri).toBe("ui://agntux-calendly/cancel");
  });

  it("no-show tool ui_resource_uri is ui://agntux-calendly/no-show", () => {
    const t = getHandler("agntux_calendly_no_show");
    // Verbatim from agntux-calendly-view.ts line 140:
    // 'const NO_SHOW_RESOURCE_URI = "ui://agntux-calendly/no-show" as const;'
    expect(t.descriptor.ui_resource_uri).toBe("ui://agntux-calendly/no-show");
  });

  it("scheduling-link tool ui_resource_uri is ui://agntux-calendly/scheduling-link", () => {
    const t = getHandler("agntux_calendly_scheduling_link");
    // Verbatim from agntux-calendly-view.ts line 285:
    // 'const SCHEDULING_LINK_RESOURCE_URI = "ui://agntux-calendly/scheduling-link" as const;'
    expect(t.descriptor.ui_resource_uri).toBe("ui://agntux-calendly/scheduling-link");
  });
});
