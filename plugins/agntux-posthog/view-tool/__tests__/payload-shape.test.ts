// =============================================================================
// payload-shape.test.ts — payload-shape regression guard for agntux-posthog.
//
// Tests ALL FOUR view tools in the single module:
//   mod.viewTools[0] = agntux_posthog_resolve   (ResolvePayload)
//   mod.viewTools[1] = agntux_posthog_reply      (ReplyPayload)
//   mod.viewTools[2] = agntux_posthog_experiment (ExperimentPayload)
//   mod.viewTools[3] = agntux_posthog_report     (ReportPayload)
//
// Assertions are grounded in handler OUTPUT (Golden Rule #1): the real
// structuredContent keys and byte size from calling viewTool.handle() with
// in-memory fixtures. NEVER grep _overrides/ prose (E30 rule).
//
// KEPT_KEYS are derived from the handler's interface definitions in
// agntux-posthog-view.ts (read verbatim before writing this file).
//
// PAYLOAD_BUDGET_BYTES:
//   Resolve   — 20 KB (status + assignee picker; no long body field)
//   Reply     — 30 KB (draft_body and thread_excerpt can be moderate)
//   Experiment — 25 KB (result_summary + variants array)
//   Report     — 20 KB (report_summary; no long body field)
//
// Pass 11 (E24/E25) of the marketplace linter verifies this file exists and
// contains a Buffer.byteLength/JSON.stringify byte-size assertion paired with
// a toBeLessThan matcher. All four payload sections satisfy this requirement.
//
// Handler reads frontmatter fields DIRECTLY via parseFrontmatter() — NOT via
// a fenced "## Compose payload" YAML block (verified by reading
// agntux-posthog-view.ts lines 151–162 / 220–225 / 280–286 / 340–345).
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  ViewToolContext,
  ViewToolFs,
  ListWithMetaEntry,
  ViewToolScope,
} from "@agntux/plugin-runtime";
import { ViewToolFsError } from "@agntux/plugin-runtime";
import mod from "../src/agntux-posthog-view.js";

// ── Tunable knobs ─────────────────────────────────────────────────────────────

const RESOLVE_BUDGET_BYTES = 20 * 1024;
const REPLY_BUDGET_BYTES = 30 * 1024;
const EXPERIMENT_BUDGET_BYTES = 25 * 1024;
const REPORT_BUDGET_BYTES = 20 * 1024;

/**
 * Resolve structuredContent keys — derived from ResolvePayload interface
 * in agntux-posthog-view.ts lines 57–67:
 *   action_id, issue_url, issue_id, issue_title, occurrence_summary,
 *   current_status, current_assignee, candidate_assignees, target_status
 */
const RESOLVE_KEPT_KEYS = new Set([
  "action_id",
  "issue_url",
  "issue_id",
  "issue_title",
  "occurrence_summary",
  "current_status",
  "current_assignee",
  "candidate_assignees",
  "target_status",
]);

/**
 * Reply structuredContent keys — derived from ReplyPayload interface
 * in agntux-posthog-view.ts lines 75–83:
 *   action_id, thread_url, source_item_title, thread_excerpt,
 *   author_name, draft_body, personalization_signals
 */
const REPLY_KEPT_KEYS = new Set([
  "action_id",
  "thread_url",
  "source_item_title",
  "thread_excerpt",
  "author_name",
  "draft_body",
  "personalization_signals",
]);

/**
 * Experiment structuredContent keys — derived from ExperimentPayload interface
 * in agntux-posthog-view.ts lines 91–99:
 *   action_id, experiment_url, experiment_id, experiment_name,
 *   variants, recommended_variant, result_summary
 */
const EXPERIMENT_KEPT_KEYS = new Set([
  "action_id",
  "experiment_url",
  "experiment_id",
  "experiment_name",
  "variants",
  "recommended_variant",
  "result_summary",
]);

/**
 * Report structuredContent keys — derived from ReportPayload interface
 * in agntux-posthog-view.ts lines 107–114:
 *   action_id, report_url, report_id, report_title, report_summary, target_state
 */
const REPORT_KEPT_KEYS = new Set([
  "action_id",
  "report_url",
  "report_id",
  "report_title",
  "report_summary",
  "target_state",
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
  const fixedNow = now ?? new Date("2026-06-19T12:00:00Z");
  const ctx: ViewToolContext = {
    fs: inMemoryFs(files),
    scope: FIXED_SCOPE,
    now: () => fixedNow,
    log: () => undefined,
    withScope: () => makeCtx(files, fixedNow),
  };
  return ctx;
}

// ── Action-file builders ───────────────────────────────────────────────────────
// The posthog view handlers read fields via parseFrontmatter() and then access
// fm.field_name from the parsed frontmatter object. Action files must be in the
// standard AgntUX YAML frontmatter format:
//   ---
//   id: <id>
//   type: action
//   <field>: <value>
//   ---
//   <body>

function makeResolveActionFile(opts: {
  id: string;
  issue_url?: string;
  issue_id?: string;
  issue_title?: string;
  occurrence_summary?: string;
  current_status?: string;
  current_assignee?: string;
  candidate_assignees?: string[];
  target_status?: string;
}): string {
  const fmLines = [
    `id: ${opts.id}`,
    `type: action`,
    `issue_url: "${opts.issue_url ?? "https://app.posthog.com/project/12345/error_tracking/789"}"`,
    `issue_id: "${opts.issue_id ?? "789"}"`,
    `issue_title: "${opts.issue_title ?? "TypeError: Cannot read property of undefined"}"`,
    `occurrence_summary: "${opts.occurrence_summary ?? "42 occurrences in the last hour, 3 users affected"}"`,
    `current_status: "${opts.current_status ?? "active"}"`,
    `current_assignee: "${opts.current_assignee ?? "alice@example.com"}"`,
    `target_status: "${opts.target_status ?? "resolved"}"`,
  ];
  const assignees = opts.candidate_assignees ?? ["alice@example.com", "bob@example.com"];
  fmLines.push(`candidate_assignees:`);
  for (const a of assignees) {
    fmLines.push(`  - "${a}"`);
  }
  return `---\n${fmLines.join("\n")}\n---\n\nInvestigate the error issue.\n`;
}

function makeReplyActionFile(opts: {
  id: string;
  thread_url?: string;
  source_item_title?: string;
  thread_excerpt?: string;
  author_name?: string;
  draft_body?: string;
  personalization_signals?: string;
}): string {
  const fmLines = [
    `id: ${opts.id}`,
    `type: action`,
    `thread_url: "${opts.thread_url ?? "https://app.posthog.com/project/12345/insights/1001"}"`,
    `source_item_title: "${opts.source_item_title ?? "Weekly Active Users Insight"}"`,
    `thread_excerpt: "${opts.thread_excerpt ?? "Hey, do you know why this dipped last Tuesday?"}"`,
    `author_name: "${opts.author_name ?? "Bob Smith"}"`,
    `draft_body: "${opts.draft_body ?? "Hi Bob, the dip was caused by a deployment outage."}"`,
    `personalization_signals: "${opts.personalization_signals ?? "user:alice, team:platform"}"`,
  ];
  return `---\n${fmLines.join("\n")}\n---\n\nReply to comment thread.\n`;
}

function makeExperimentActionFile(opts: {
  id: string;
  experiment_url?: string;
  experiment_id?: string;
  experiment_name?: string;
  variants?: string[];
  recommended_variant?: string;
  result_summary?: string;
}): string {
  const fmLines = [
    `id: ${opts.id}`,
    `type: action`,
    `experiment_url: "${opts.experiment_url ?? "https://app.posthog.com/project/12345/experiments/55"}"`,
    `experiment_id: "${opts.experiment_id ?? "55"}"`,
    `experiment_name: "${opts.experiment_name ?? "New Checkout Flow"}"`,
    `recommended_variant: "${opts.recommended_variant ?? "test"}"`,
    `result_summary: "${opts.result_summary ?? "test variant shows +12% conversion, p=0.02"}"`,
  ];
  const variants = opts.variants ?? ["control", "test"];
  fmLines.push(`variants:`);
  for (const v of variants) {
    fmLines.push(`  - "${v}"`);
  }
  return `---\n${fmLines.join("\n")}\n---\n\nDecide on the experiment variant.\n`;
}

function makeReportActionFile(opts: {
  id: string;
  report_url?: string;
  report_id?: string;
  report_title?: string;
  report_summary?: string;
  target_state?: string;
}): string {
  const fmLines = [
    `id: ${opts.id}`,
    `type: action`,
    `report_url: "${opts.report_url ?? "https://app.posthog.com/project/12345/inbox"}"`,
    `report_id: "${opts.report_id ?? "r-42"}"`,
    `report_title: "${opts.report_title ?? "Anomaly: signup_conversion dropped 30%"}"`,
    `report_summary: "${opts.report_summary ?? "Triggered by a 30% drop in signup conversion on June 18."}"`,
    `target_state: "${opts.target_state ?? "resolved"}"`,
  ];
  return `---\n${fmLines.join("\n")}\n---\n\nReview flagged inbox report.\n`;
}

// ── View tools under test ─────────────────────────────────────────────────────
// Order matches agntux-posthog-view.ts line 545:
// viewTools: [resolveViewTool, replyViewTool, experimentViewTool, reportViewTool]

const resolveViewTool = mod.viewTools[0]!;
const replyViewTool = mod.viewTools[1]!;
const experimentViewTool = mod.viewTools[2]!;
const reportViewTool = mod.viewTools[3]!;

// =============================================================================
// RESOLVE
// =============================================================================

describe("agntux_posthog_resolve payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const heavySummary = "O".repeat(5000); // exercise long occurrence summary
    const files = {
      "actions/resolve-1.md": makeResolveActionFile({
        id: "resolve-1",
        occurrence_summary: heavySummary,
        candidate_assignees: Array.from({ length: 20 }, (_, i) => `user${i}@example.com`),
      }),
    };
    const result = await resolveViewTool.handle(
      { action_id: "resolve-1" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(RESOLVE_BUDGET_BYTES);
    // Sanity: occurrence_summary was forwarded
    expect((sc as Record<string, unknown>).occurrence_summary).toBe(heavySummary);
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/resolve-k1.md": makeResolveActionFile({ id: "resolve-k1" }),
    };
    const result = await resolveViewTool.handle(
      { action_id: "resolve-k1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(
        RESOLVE_KEPT_KEYS.has(k),
        `unexpected key "${k}" in resolve structuredContent`,
      ).toBe(true);
    }
    for (const k of RESOLVE_KEPT_KEYS) {
      expect(
        keys.has(k),
        `missing required key "${k}" in resolve structuredContent`,
      ).toBe(true);
    }
  });

  it("returns sensible field values from action frontmatter", async () => {
    const files = {
      "actions/resolve-v1.md": makeResolveActionFile({
        id: "resolve-v1",
        issue_id: "999",
        issue_title: "NullPointerException in payments",
        current_status: "active",
        target_status: "resolved",
        candidate_assignees: ["alice@example.com"],
      }),
    };
    const result = await resolveViewTool.handle(
      { action_id: "resolve-v1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("resolve-v1");
    expect(sc.issue_id).toBe("999");
    expect(sc.issue_title).toBe("NullPointerException in payments");
    expect(sc.current_status).toBe("active");
    expect(sc.target_status).toBe("resolved");
    expect(Array.isArray(sc.candidate_assignees)).toBe(true);
    expect((sc.candidate_assignees as string[]).length).toBeGreaterThan(0);
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await resolveViewTool.handle(
      { action_id: "does-not-exist" },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(RESOLVE_BUDGET_BYTES);
  });
});

describe("agntux_posthog_resolve render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await resolveViewTool.handle(
      {} as { action_id: string },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(
        RESOLVE_KEPT_KEYS.has(k),
        `unexpected key "${k}" in resolve placeholder`,
      ).toBe(true);
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(RESOLVE_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("degrades to a placeholder when ctx.fs throws a non-ViewToolFsError", async () => {
    const ctx = makeCtx({});
    ctx.fs.readFile = async () => {
      throw new Error("boom: backend unavailable");
    };
    const result = await resolveViewTool.handle(
      { action_id: "anything" },
      ctx,
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(RESOLVE_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });
});

describe("agntux_posthog_resolve response envelope guard", () => {
  function assertEnvelope(content: unknown) {
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0].type).toBe("text");
    const text = content[0].text as string;
    // Anchor strings from MCP_APP_SUFFIX in agntux-posthog-view.ts lines 369–374
    expect(text).toContain("iframe");
    expect(text).toContain("host");
    expect(text).toContain("MCP App");
  }

  it("success path ships the canonical content[] explanation", async () => {
    const files = {
      "actions/env-r1.md": makeResolveActionFile({ id: "env-r1" }),
    };
    const result = await resolveViewTool.handle(
      { action_id: "env-r1" },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });

  it("missing-file error branch also ships the canonical content[] explanation", async () => {
    const result = await resolveViewTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    assertEnvelope(result.content);
  });
});

// =============================================================================
// REPLY
// =============================================================================

describe("agntux_posthog_reply payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const heavyDraft = "D".repeat(8000); // exercise long draft body
    const files = {
      "actions/reply-1.md": makeReplyActionFile({
        id: "reply-1",
        draft_body: heavyDraft,
      }),
    };
    const result = await replyViewTool.handle(
      { action_id: "reply-1" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(REPLY_BUDGET_BYTES);
    // Sanity: draft_body was forwarded
    expect((sc as Record<string, unknown>).draft_body).toBe(heavyDraft);
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/reply-k1.md": makeReplyActionFile({ id: "reply-k1" }),
    };
    const result = await replyViewTool.handle(
      { action_id: "reply-k1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(
        REPLY_KEPT_KEYS.has(k),
        `unexpected key "${k}" in reply structuredContent`,
      ).toBe(true);
    }
    for (const k of REPLY_KEPT_KEYS) {
      expect(
        keys.has(k),
        `missing required key "${k}" in reply structuredContent`,
      ).toBe(true);
    }
  });

  it("returns sensible field values from action frontmatter", async () => {
    const files = {
      "actions/reply-v1.md": makeReplyActionFile({
        id: "reply-v1",
        author_name: "Carol Davis",
        draft_body: "Thanks for the heads up!",
        source_item_title: "Revenue Insight",
      }),
    };
    const result = await replyViewTool.handle(
      { action_id: "reply-v1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("reply-v1");
    expect(sc.author_name).toBe("Carol Davis");
    expect(sc.draft_body).toBe("Thanks for the heads up!");
    expect(sc.source_item_title).toBe("Revenue Insight");
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await replyViewTool.handle(
      { action_id: "does-not-exist" },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(REPLY_BUDGET_BYTES);
  });
});

describe("agntux_posthog_reply render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await replyViewTool.handle(
      {} as { action_id: string },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(
        REPLY_KEPT_KEYS.has(k),
        `unexpected key "${k}" in reply placeholder`,
      ).toBe(true);
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(REPLY_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("degrades to a placeholder when ctx.fs throws a non-ViewToolFsError", async () => {
    const ctx = makeCtx({});
    ctx.fs.readFile = async () => {
      throw new Error("boom: backend unavailable");
    };
    const result = await replyViewTool.handle({ action_id: "anything" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(REPLY_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });
});

describe("agntux_posthog_reply response envelope guard", () => {
  function assertEnvelope(content: unknown) {
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0].type).toBe("text");
    const text = content[0].text as string;
    expect(text).toContain("iframe");
    expect(text).toContain("host");
    expect(text).toContain("MCP App");
  }

  it("success path ships the canonical content[] explanation", async () => {
    const files = {
      "actions/env-rp1.md": makeReplyActionFile({ id: "env-rp1" }),
    };
    const result = await replyViewTool.handle(
      { action_id: "env-rp1" },
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
});

// =============================================================================
// EXPERIMENT
// =============================================================================

describe("agntux_posthog_experiment payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const heavyResult = "R".repeat(5000); // exercise long result summary
    const files = {
      "actions/exp-1.md": makeExperimentActionFile({
        id: "exp-1",
        result_summary: heavyResult,
        variants: Array.from({ length: 10 }, (_, i) => `variant-${i}`),
      }),
    };
    const result = await experimentViewTool.handle(
      { action_id: "exp-1" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(EXPERIMENT_BUDGET_BYTES);
    // Sanity: result_summary was forwarded
    expect((sc as Record<string, unknown>).result_summary).toBe(heavyResult);
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/exp-k1.md": makeExperimentActionFile({ id: "exp-k1" }),
    };
    const result = await experimentViewTool.handle(
      { action_id: "exp-k1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(
        EXPERIMENT_KEPT_KEYS.has(k),
        `unexpected key "${k}" in experiment structuredContent`,
      ).toBe(true);
    }
    for (const k of EXPERIMENT_KEPT_KEYS) {
      expect(
        keys.has(k),
        `missing required key "${k}" in experiment structuredContent`,
      ).toBe(true);
    }
  });

  it("returns sensible field values from action frontmatter", async () => {
    const files = {
      "actions/exp-v1.md": makeExperimentActionFile({
        id: "exp-v1",
        experiment_id: "77",
        experiment_name: "New Onboarding Flow",
        variants: ["control", "streamlined"],
        recommended_variant: "streamlined",
      }),
    };
    const result = await experimentViewTool.handle(
      { action_id: "exp-v1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("exp-v1");
    expect(sc.experiment_id).toBe("77");
    expect(sc.experiment_name).toBe("New Onboarding Flow");
    expect(sc.recommended_variant).toBe("streamlined");
    expect(Array.isArray(sc.variants)).toBe(true);
    expect((sc.variants as string[])).toContain("streamlined");
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await experimentViewTool.handle(
      { action_id: "does-not-exist" },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(EXPERIMENT_BUDGET_BYTES);
  });
});

describe("agntux_posthog_experiment render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await experimentViewTool.handle(
      {} as { action_id: string },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(
        EXPERIMENT_KEPT_KEYS.has(k),
        `unexpected key "${k}" in experiment placeholder`,
      ).toBe(true);
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(EXPERIMENT_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("degrades to a placeholder when ctx.fs throws a non-ViewToolFsError", async () => {
    const ctx = makeCtx({});
    ctx.fs.readFile = async () => {
      throw new Error("boom: backend unavailable");
    };
    const result = await experimentViewTool.handle(
      { action_id: "anything" },
      ctx,
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(EXPERIMENT_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });
});

describe("agntux_posthog_experiment response envelope guard", () => {
  function assertEnvelope(content: unknown) {
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0].type).toBe("text");
    const text = content[0].text as string;
    expect(text).toContain("iframe");
    expect(text).toContain("host");
    expect(text).toContain("MCP App");
  }

  it("success path ships the canonical content[] explanation", async () => {
    const files = {
      "actions/env-e1.md": makeExperimentActionFile({ id: "env-e1" }),
    };
    const result = await experimentViewTool.handle(
      { action_id: "env-e1" },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });

  it("missing-file error branch also ships the canonical content[] explanation", async () => {
    const result = await experimentViewTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    assertEnvelope(result.content);
  });
});

// =============================================================================
// REPORT
// =============================================================================

describe("agntux_posthog_report payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const heavySummary = "S".repeat(5000); // exercise long report summary
    const files = {
      "actions/report-1.md": makeReportActionFile({
        id: "report-1",
        report_summary: heavySummary,
      }),
    };
    const result = await reportViewTool.handle(
      { action_id: "report-1" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(REPORT_BUDGET_BYTES);
    // Sanity: report_summary was forwarded
    expect((sc as Record<string, unknown>).report_summary).toBe(heavySummary);
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/report-k1.md": makeReportActionFile({ id: "report-k1" }),
    };
    const result = await reportViewTool.handle(
      { action_id: "report-k1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(
        REPORT_KEPT_KEYS.has(k),
        `unexpected key "${k}" in report structuredContent`,
      ).toBe(true);
    }
    for (const k of REPORT_KEPT_KEYS) {
      expect(
        keys.has(k),
        `missing required key "${k}" in report structuredContent`,
      ).toBe(true);
    }
  });

  it("returns sensible field values from action frontmatter", async () => {
    const files = {
      "actions/report-v1.md": makeReportActionFile({
        id: "report-v1",
        report_id: "r-77",
        report_title: "Anomaly: DAU dropped 25%",
        target_state: "resolved",
      }),
    };
    const result = await reportViewTool.handle(
      { action_id: "report-v1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("report-v1");
    expect(sc.report_id).toBe("r-77");
    expect(sc.report_title).toBe("Anomaly: DAU dropped 25%");
    expect(sc.target_state).toBe("resolved");
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await reportViewTool.handle(
      { action_id: "does-not-exist" },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(REPORT_BUDGET_BYTES);
  });
});

describe("agntux_posthog_report render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await reportViewTool.handle(
      {} as { action_id: string },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(
        REPORT_KEPT_KEYS.has(k),
        `unexpected key "${k}" in report placeholder`,
      ).toBe(true);
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(REPORT_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("degrades to a placeholder when ctx.fs throws a non-ViewToolFsError", async () => {
    const ctx = makeCtx({});
    ctx.fs.readFile = async () => {
      throw new Error("boom: backend unavailable");
    };
    const result = await reportViewTool.handle({ action_id: "anything" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(REPORT_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });
});

describe("agntux_posthog_report response envelope guard", () => {
  function assertEnvelope(content: unknown) {
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0].type).toBe("text");
    const text = content[0].text as string;
    expect(text).toContain("iframe");
    expect(text).toContain("host");
    expect(text).toContain("MCP App");
  }

  it("success path ships the canonical content[] explanation", async () => {
    const files = {
      "actions/env-rpt1.md": makeReportActionFile({ id: "env-rpt1" }),
    };
    const result = await reportViewTool.handle(
      { action_id: "env-rpt1" },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });

  it("missing-file error branch also ships the canonical content[] explanation", async () => {
    const result = await reportViewTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    assertEnvelope(result.content);
  });
});

// =============================================================================
// Descriptor contract — tool names, resource URIs, outputSchema, module count
// =============================================================================

describe("view tool descriptors", () => {
  it("resolve tool name is agntux_posthog_resolve", () => {
    // Verbatim from agntux-posthog-view.ts line 379
    expect(resolveViewTool.descriptor.name).toBe("agntux_posthog_resolve");
  });

  it("reply tool name is agntux_posthog_reply", () => {
    // Verbatim from agntux-posthog-view.ts line 427
    expect(replyViewTool.descriptor.name).toBe("agntux_posthog_reply");
  });

  it("experiment tool name is agntux_posthog_experiment", () => {
    // Verbatim from agntux-posthog-view.ts line 463
    expect(experimentViewTool.descriptor.name).toBe("agntux_posthog_experiment");
  });

  it("report tool name is agntux_posthog_report", () => {
    // Verbatim from agntux-posthog-view.ts line 504
    expect(reportViewTool.descriptor.name).toBe("agntux_posthog_report");
  });

  it("resolve resource URI is ui://agntux-posthog/resolve", () => {
    // Verbatim from agntux-posthog-view.ts line 29 RESOLVE_RESOURCE_URI
    expect(resolveViewTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-posthog/resolve",
    );
  });

  it("reply resource URI is ui://agntux-posthog/reply", () => {
    // Verbatim from agntux-posthog-view.ts line 30 REPLY_RESOURCE_URI
    expect(replyViewTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-posthog/reply",
    );
  });

  it("experiment resource URI is ui://agntux-posthog/experiment", () => {
    // Verbatim from agntux-posthog-view.ts line 31 EXPERIMENT_RESOURCE_URI
    expect(experimentViewTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-posthog/experiment",
    );
  });

  it("report resource URI is ui://agntux-posthog/report", () => {
    // Verbatim from agntux-posthog-view.ts line 32 REPORT_RESOURCE_URI
    expect(reportViewTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-posthog/report",
    );
  });

  it("resolve outputSchema requires exactly the RESOLVE_KEPT_KEYS", () => {
    const schema = resolveViewTool.descriptor.outputSchema as { required: string[] };
    const required = new Set(schema.required);
    for (const k of RESOLVE_KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(true);
    }
    expect(schema.required.length).toBe(RESOLVE_KEPT_KEYS.size);
  });

  it("reply outputSchema requires exactly the REPLY_KEPT_KEYS", () => {
    const schema = replyViewTool.descriptor.outputSchema as { required: string[] };
    const required = new Set(schema.required);
    for (const k of REPLY_KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(true);
    }
    expect(schema.required.length).toBe(REPLY_KEPT_KEYS.size);
  });

  it("experiment outputSchema requires exactly the EXPERIMENT_KEPT_KEYS", () => {
    const schema = experimentViewTool.descriptor.outputSchema as { required: string[] };
    const required = new Set(schema.required);
    for (const k of EXPERIMENT_KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(true);
    }
    expect(schema.required.length).toBe(EXPERIMENT_KEPT_KEYS.size);
  });

  it("report outputSchema requires exactly the REPORT_KEPT_KEYS", () => {
    const schema = reportViewTool.descriptor.outputSchema as { required: string[] };
    const required = new Set(schema.required);
    for (const k of REPORT_KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(true);
    }
    expect(schema.required.length).toBe(REPORT_KEPT_KEYS.size);
  });

  it("module exports exactly 4 view tools", () => {
    expect(mod.viewTools).toHaveLength(4);
  });
});
