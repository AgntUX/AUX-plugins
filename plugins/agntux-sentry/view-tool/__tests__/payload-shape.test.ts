// =============================================================================
// payload-shape.test.ts — payload-shape regression guard for agntux-sentry.
//
// Exercises all 3 view tools via their compiled handlers by calling
// viewTool.handle(args, ctx) with in-memory relay-style args.
//
// The sentry handlers are relay-pattern (no action file read — args come
// inline from the host). ctx.fs is never consulted; a minimal stub suffices.
//
// KEPT_KEYS sets are derived verbatim from the TypeScript interfaces in
// src/agntux-sentry-view.ts — read before authoring, no phantom keys.
//
// Resolve (ResolvePayload):
//   issue_url, issue_short_id, issue_title, level, project,
//   events_count, users_affected, last_seen, resolve_in_next_release
//
// Ignore (IgnorePayload):
//   issue_url, issue_short_id, issue_title, level, project,
//   events_count, users_affected, ignore_mode, ignore_duration_minutes, ignore_count
//
// Assign (AssignPayload):
//   issue_url, issue_short_id, issue_title, current_assignee, candidate_assignees
//
// PAYLOAD_BUDGET_BYTES = 24 KB — sentry payloads are compact relay fields;
// well below the 64 KB host cap even with a long candidate_assignees list.
//
// Pass 11 (E24/E25) of the marketplace linter requires a
// Buffer.byteLength + JSON.stringify + toBeLessThan assertion.
// =============================================================================

import { describe, expect, it } from "vitest";
import type { ViewToolContext, ViewToolFs, ListWithMetaEntry } from "@agntux/plugin-runtime";
import mod from "../src/agntux-sentry-view.js";

// ── Budget ────────────────────────────────────────────────────────────────────

// 24 KB per single-item relay payload — compact compared to Jira/Calendar.
const PAYLOAD_BUDGET_BYTES = 24 * 1024;

// ── structuredContent key sets (verbatim from ResolvePayload / IgnorePayload /
//    AssignPayload interfaces in src/agntux-sentry-view.ts) ────────────────────

const RESOLVE_KEYS = new Set<string>([
  "issue_url",
  "issue_short_id",
  "issue_title",
  "level",
  "project",
  "events_count",
  "users_affected",
  "last_seen",
  "resolve_in_next_release",
]);

const IGNORE_KEYS = new Set<string>([
  "issue_url",
  "issue_short_id",
  "issue_title",
  "level",
  "project",
  "events_count",
  "users_affected",
  "ignore_mode",
  "ignore_duration_minutes",
  "ignore_count",
]);

const ASSIGN_KEYS = new Set<string>([
  "issue_url",
  "issue_short_id",
  "issue_title",
  "current_assignee",
  "candidate_assignees",
]);

// ── Minimal fs stub (relay-pattern: ctx.fs is never called) ──────────────────

const NOOP_FS: ViewToolFs = {
  async readFile(path: string): Promise<Buffer> {
    throw new Error(`fs.readFile called unexpectedly: ${path}`);
  },
  async readMany(paths: string[]): Promise<(Buffer | null)[]> {
    return paths.map(() => null);
  },
  async list(_prefix: string): Promise<string[]> {
    return [];
  },
  async listWithMeta(_prefix: string): Promise<ListWithMetaEntry[]> {
    return [];
  },
  async exists(_path: string): Promise<boolean> {
    return false;
  },
};

function makeCtx(): ViewToolContext {
  const ctx: ViewToolContext = {
    fs: NOOP_FS,
    scope: { user_id: "test-user", organization_id: "test-org" },
    now: () => new Date("2026-06-26T12:00:00Z"),
    log: () => undefined,
    withScope: () => makeCtx(),
  };
  return ctx;
}

// ── Handler references (order matches listing.yaml ui_components) ─────────────
// [0] agntux_sentry_resolve_view
// [1] agntux_sentry_ignore_view
// [2] agntux_sentry_assign_view

const resolveTool = mod.viewTools[0]!;
const ignoreTool = mod.viewTools[1]!;
const assignTool = mod.viewTools[2]!;

// ── Helper: frozen keyset assertion ──────────────────────────────────────────

function assertKeySet(
  sc: Record<string, unknown>,
  expected: Set<string>,
  label: string,
): void {
  const actual = new Set(Object.keys(sc));
  for (const k of actual) {
    expect(
      expected.has(k),
      `unexpected key "${k}" in ${label} structuredContent`,
    ).toBe(true);
  }
  for (const k of expected) {
    expect(
      actual.has(k),
      `missing required key "${k}" in ${label} structuredContent`,
    ).toBe(true);
  }
}

// =============================================================================
// RESOLVE VIEW
// =============================================================================

describe("agntux_sentry_resolve_view — payload shape", () => {
  it("descriptor name is agntux_sentry_resolve_view", () => {
    expect(resolveTool.descriptor.name).toBe("agntux_sentry_resolve_view");
  });

  it("returns placeholder (not throwing) when called with empty args", async () => {
    const result = await resolveTool.handle({}, makeCtx());
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, RESOLVE_KEYS, "resolve/empty");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("returns well-shaped ResolvePayload for a full resolve-now call", async () => {
    const args = {
      issue_url: "https://acme.sentry.io/issues/1234/",
      issue_short_id: "web-1Z43",
      issue_title: "NullPointerException in UserController.getProfile",
      level: "error",
      project: "web",
      events_count: 142,
      users_affected: 17,
      last_seen: "2026-06-26T11:00:00.000Z",
      resolve_in_next_release: false,
    };
    const result = await resolveTool.handle(args, makeCtx());
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, RESOLVE_KEYS, "resolve/full");
    expect(sc.issue_short_id).toBe("web-1Z43");
    expect(sc.issue_url).toBe("https://acme.sentry.io/issues/1234/");
    expect(sc.resolve_in_next_release).toBe(false);
    expect(sc.events_count).toBe(142);
    expect(sc.users_affected).toBe(17);
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("returns well-shaped ResolvePayload for resolve-in-next-release", async () => {
    const args = {
      issue_url: "https://acme.sentry.io/issues/5678/",
      issue_short_id: "api-worker-AB12",
      issue_title: "Timeout in PaymentsService",
      level: "fatal",
      project: "api-worker",
      events_count: 3,
      users_affected: 0,
      last_seen: "2026-06-26T09:00:00.000Z",
      resolve_in_next_release: true,
    };
    const result = await resolveTool.handle(args, makeCtx());
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.resolve_in_next_release).toBe(true);
    expect(sc.issue_short_id).toBe("api-worker-AB12");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("content[] item has type text", async () => {
    const result = await resolveTool.handle({}, makeCtx());
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0].type).toBe("text");
  });

  it("structuredContent keys are frozen — no extra keys beyond RESOLVE_KEYS", async () => {
    const result = await resolveTool.handle(
      {
        issue_url: "https://acme.sentry.io/issues/999/",
        issue_short_id: "web-X1",
        issue_title: "Test",
        level: "warning",
        project: "web",
        events_count: 1,
        users_affected: 0,
        last_seen: "2026-06-26T00:00:00.000Z",
        resolve_in_next_release: false,
      },
      makeCtx(),
    );
    const keys = Object.keys(result.structuredContent);
    expect(keys).toHaveLength(RESOLVE_KEYS.size);
    for (const k of keys) {
      expect(RESOLVE_KEYS.has(k), `unexpected key: ${k}`).toBe(true);
    }
  });
});

// =============================================================================
// IGNORE VIEW
// =============================================================================

describe("agntux_sentry_ignore_view — payload shape", () => {
  it("descriptor name is agntux_sentry_ignore_view", () => {
    expect(ignoreTool.descriptor.name).toBe("agntux_sentry_ignore_view");
  });

  it("returns placeholder (not throwing) when called with empty args", async () => {
    const result = await ignoreTool.handle({}, makeCtx());
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, IGNORE_KEYS, "ignore/empty");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("placeholder ignore_mode defaults to untilEscalating", async () => {
    const result = await ignoreTool.handle({}, makeCtx());
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.ignore_mode).toBe("untilEscalating");
  });

  it("returns well-shaped IgnorePayload for ignore-until-escalating", async () => {
    const args = {
      issue_url: "https://acme.sentry.io/issues/2001/",
      issue_short_id: "web-C7D8",
      issue_title: "DeprecationWarning in legacy module",
      level: "warning",
      project: "web",
      events_count: 5,
      users_affected: 0,
      ignore_mode: "untilEscalating",
      ignore_duration_minutes: 0,
      ignore_count: 0,
    };
    const result = await ignoreTool.handle(args, makeCtx());
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, IGNORE_KEYS, "ignore/untilEscalating");
    expect(sc.ignore_mode).toBe("untilEscalating");
    expect(sc.issue_short_id).toBe("web-C7D8");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("returns well-shaped IgnorePayload for ignore-for-duration", async () => {
    const args = {
      issue_url: "https://acme.sentry.io/issues/3001/",
      issue_short_id: "mobile-ios-FE90",
      issue_title: "GraphQL timeout on slow network",
      level: "error",
      project: "mobile-ios",
      events_count: 20,
      users_affected: 4,
      ignore_mode: "forDuration",
      ignore_duration_minutes: 1440,
      ignore_count: 0,
    };
    const result = await ignoreTool.handle(args, makeCtx());
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, IGNORE_KEYS, "ignore/forDuration");
    expect(sc.ignore_mode).toBe("forDuration");
    expect(sc.ignore_duration_minutes).toBe(1440);
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("content[] item has type text", async () => {
    const result = await ignoreTool.handle({}, makeCtx());
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0].type).toBe("text");
  });

  it("structuredContent keys are frozen — no extra keys beyond IGNORE_KEYS", async () => {
    const result = await ignoreTool.handle(
      {
        issue_url: "https://acme.sentry.io/issues/100/",
        issue_short_id: "web-AA01",
        issue_title: "Frozen keyset test",
        level: "info",
        project: "web",
        events_count: 1,
        users_affected: 0,
        ignore_mode: "forever",
        ignore_duration_minutes: 0,
        ignore_count: 0,
      },
      makeCtx(),
    );
    const keys = Object.keys(result.structuredContent);
    expect(keys).toHaveLength(IGNORE_KEYS.size);
    for (const k of keys) {
      expect(IGNORE_KEYS.has(k), `unexpected key: ${k}`).toBe(true);
    }
  });
});

// =============================================================================
// ASSIGN VIEW
// =============================================================================

describe("agntux_sentry_assign_view — payload shape", () => {
  it("descriptor name is agntux_sentry_assign_view", () => {
    expect(assignTool.descriptor.name).toBe("agntux_sentry_assign_view");
  });

  it("returns placeholder (not throwing) when called with empty args", async () => {
    const result = await assignTool.handle({}, makeCtx());
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, ASSIGN_KEYS, "assign/empty");
    expect(Array.isArray(sc.candidate_assignees)).toBe(true);
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("placeholder candidate_assignees is empty array", async () => {
    const result = await assignTool.handle({}, makeCtx());
    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc.candidate_assignees as unknown[]).length).toBe(0);
  });

  it("returns well-shaped AssignPayload with user candidates", async () => {
    const args = {
      issue_url: "https://acme.sentry.io/issues/4001/",
      issue_short_id: "web-GH45",
      issue_title: "Database connection pool exhausted",
      current_assignee: "",
      candidate_assignees: [
        { id: "u1", label: "Alice Chen", kind: "user" },
        { id: "u2", label: "Bob Reyes", kind: "user" },
      ],
    };
    const result = await assignTool.handle(args, makeCtx());
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, ASSIGN_KEYS, "assign/user-candidates");
    expect(sc.issue_short_id).toBe("web-GH45");
    const candidates = sc.candidate_assignees as unknown[];
    expect(candidates).toHaveLength(2);
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("returns well-shaped AssignPayload with a team candidate", async () => {
    const args = {
      issue_url: "https://acme.sentry.io/issues/5001/",
      issue_short_id: "api-worker-KL89",
      issue_title: "Redis eviction under load",
      current_assignee: "Alice Chen",
      candidate_assignees: [
        { id: "backend-team", label: "Backend Team", kind: "team" },
        { id: "u3", label: "Carol Singh", kind: "user" },
      ],
    };
    const result = await assignTool.handle(args, makeCtx());
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, ASSIGN_KEYS, "assign/team-candidate");
    expect(sc.current_assignee).toBe("Alice Chen");
    const candidates = sc.candidate_assignees as Array<{ id: string; label: string; kind: string }>;
    expect(candidates).toHaveLength(2);
    const teamEntry = candidates.find((c) => c.kind === "team");
    expect(teamEntry).toBeDefined();
    expect(teamEntry?.id).toBe("backend-team");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("filters out malformed candidate_assignees entries (missing id or label)", async () => {
    // Handler defensively filters invalid candidates — confirmed from source
    const args = {
      issue_url: "https://acme.sentry.io/issues/6001/",
      issue_short_id: "web-MN12",
      issue_title: "Malformed candidates test",
      current_assignee: "",
      candidate_assignees: [
        { id: "u1", label: "Alice", kind: "user" },
        { id: "", label: "NoId", kind: "user" },       // malformed: empty id
        { id: "u3", label: "", kind: "user" },          // malformed: empty label
        null,                                           // malformed: null entry
        { id: "t1", label: "Backend", kind: "team" },
      ],
    };
    const result = await assignTool.handle(args, makeCtx());
    const sc = result.structuredContent as Record<string, unknown>;
    const candidates = sc.candidate_assignees as unknown[];
    // Only Alice (u1) and Backend (t1) should survive
    expect(candidates).toHaveLength(2);
  });

  it("content[] item has type text", async () => {
    const result = await assignTool.handle({}, makeCtx());
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0].type).toBe("text");
  });

  it("structuredContent keys are frozen — no extra keys beyond ASSIGN_KEYS", async () => {
    const result = await assignTool.handle(
      {
        issue_url: "https://acme.sentry.io/issues/999/",
        issue_short_id: "web-ZZ99",
        issue_title: "Frozen keyset test",
        current_assignee: "",
        candidate_assignees: [],
      },
      makeCtx(),
    );
    const keys = Object.keys(result.structuredContent);
    expect(keys).toHaveLength(ASSIGN_KEYS.size);
    for (const k of keys) {
      expect(ASSIGN_KEYS.has(k), `unexpected key: ${k}`).toBe(true);
    }
  });
});

// =============================================================================
// Module shape — all three view tools exported
// =============================================================================

describe("view tool module shape", () => {
  it("mod.viewTools has exactly 3 entries", () => {
    expect(mod.viewTools).toHaveLength(3);
  });

  it("tool[0] is agntux_sentry_resolve_view", () => {
    expect(mod.viewTools[0]!.descriptor.name).toBe("agntux_sentry_resolve_view");
  });

  it("tool[1] is agntux_sentry_ignore_view", () => {
    expect(mod.viewTools[1]!.descriptor.name).toBe("agntux_sentry_ignore_view");
  });

  it("tool[2] is agntux_sentry_assign_view", () => {
    expect(mod.viewTools[2]!.descriptor.name).toBe("agntux_sentry_assign_view");
  });

  it("each tool has a descriptor with outputSchema.additionalProperties: false", () => {
    // Frozen output schema (additionalProperties: false) — verified in source
    for (const tool of mod.viewTools) {
      expect(
        (tool.descriptor.outputSchema as { additionalProperties: boolean })
          .additionalProperties,
      ).toBe(false);
    }
  });

  it("each tool has a ui_resource_uri under ui://agntux-sentry/", () => {
    // Verbatim URIs from src/agntux-sentry-view.ts constants
    const expectedUris = new Set([
      "ui://agntux-sentry/resolve",
      "ui://agntux-sentry/ignore",
      "ui://agntux-sentry/assign",
    ]);
    for (const tool of mod.viewTools) {
      const uri = tool.descriptor.ui_resource_uri as string;
      expect(expectedUris.has(uri), `unexpected ui_resource_uri: ${uri}`).toBe(true);
    }
  });
});

// =============================================================================
// Render-harness contract — all 3 handlers must survive {} args (cold render)
// =============================================================================

describe("render-harness contract — all handlers survive empty args {} (cold render)", () => {
  const TOOLS = [
    { name: "agntux_sentry_resolve_view", tool: resolveTool, keys: RESOLVE_KEYS },
    { name: "agntux_sentry_ignore_view", tool: ignoreTool, keys: IGNORE_KEYS },
    { name: "agntux_sentry_assign_view", tool: assignTool, keys: ASSIGN_KEYS },
  ];

  for (const { name, tool, keys } of TOOLS) {
    it(`${name}: returns all expected keys for empty args`, async () => {
      const result = await tool.handle({}, makeCtx());
      const sc = result.structuredContent as Record<string, unknown>;
      assertKeySet(sc, keys, `${name}/cold-render`);
      expect(Array.isArray(result.content)).toBe(true);
    });

    it(`${name}: stays under PAYLOAD_BUDGET_BYTES (${PAYLOAD_BUDGET_BYTES} B)`, async () => {
      const result = await tool.handle({}, makeCtx());
      const bytes = Buffer.byteLength(
        JSON.stringify(result.structuredContent),
        "utf8",
      );
      expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    });
  }
});
