/**
 * triage-view.test.ts
 *
 * Unit tests for the `triage_view` render tool. Tests against real on-disk
 * fixtures rooted at a temp `agntux/` directory; the handler reads from the
 * resolved AgntUX project root, so each test injects the fixture root via
 * `AGNTUX_ROOT_OVERRIDE` (vitest workers can't `process.chdir`).
 *
 * Coverage targets:
 *   - bootstrap_mode true when actions/ is empty
 *   - structured error when actions/ is missing
 *   - frontmatter parsing (id, status, priority, related_entities,
 *     suggested_actions block scalars, due_by, snoozed_until)
 *   - sort: priority then due_by
 *   - cap: actions ≤ 30 (default), counts.truncated when over
 *   - cap: handled_recent ≤ 10
 *   - cap: handled excludes items older than view_handled_days
 *   - body excerpts truncated to ≤ 600 chars
 *   - malformed YAML doesn't crash the render
 *   - traversal-attempted ID via filename can't escape (handler only globs
 *     actions/*.md, so this is implicitly safe — sanity assert)
 *   - input clamping: limit > 50 clamps to 50; view_handled_days > 30 clamps to 30
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTriageView } from "../src/tools/triage-view.js";

let tempBase: string;
let agntuxRoot: string;
let actionsDir: string;
const ORIGINAL_OVERRIDE = process.env.AGNTUX_ROOT_OVERRIDE;

function isoMinus(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function writeAction(name: string, frontmatter: string, body = ""): void {
  writeFileSync(join(actionsDir, `${name}.md`), `---\n${frontmatter}\n---\n\n${body}`);
}

function asPayload(result: Awaited<ReturnType<typeof handleTriageView>>): Record<string, unknown> {
  return result.structuredContent as unknown as Record<string, unknown>;
}

beforeEach(() => {
  tempBase = join(
    tmpdir(),
    `agntux-triage-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  );
  agntuxRoot = join(tempBase, "agntux");
  actionsDir = join(agntuxRoot, "actions");
  mkdirSync(actionsDir, { recursive: true });
  // Inject the fixture root via env var rather than process.chdir, which is
  // unsupported in vitest worker threads (ERR_WORKER_UNSUPPORTED_OPERATION).
  process.env.AGNTUX_ROOT_OVERRIDE = agntuxRoot;
});

afterEach(() => {
  if (ORIGINAL_OVERRIDE === undefined) {
    delete process.env.AGNTUX_ROOT_OVERRIDE;
  } else {
    process.env.AGNTUX_ROOT_OVERRIDE = ORIGINAL_OVERRIDE;
  }
  try {
    rmSync(tempBase, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("handleTriageView — graceful degraded states", () => {
  it("returns bootstrap_mode true when actions dir is empty", async () => {
    const result = await handleTriageView({});
    const payload = asPayload(result);
    expect(payload.error).toBeUndefined();
    expect(payload.bootstrap_mode).toBe(true);
    expect(payload.actions).toEqual([]);
    expect(payload.handled_recent).toEqual([]);
  });

  it("returns actions_index_missing when actions dir does not exist", async () => {
    rmSync(actionsDir, { recursive: true });
    const result = await handleTriageView({});
    expect((result.structuredContent as Record<string, unknown>).error).toBe(
      "actions_index_missing",
    );
  });

  it("returns actions_index_missing when actions path is a file", async () => {
    rmSync(actionsDir, { recursive: true });
    writeFileSync(actionsDir, "not a directory");
    const result = await handleTriageView({});
    expect((result.structuredContent as Record<string, unknown>).error).toBe(
      "actions_index_missing",
    );
  });
});

describe("handleTriageView — frontmatter parsing", () => {
  it("parses an open action with all canonical fields", async () => {
    writeAction(
      "test-1",
      `id: test-1
type: action-item
schema_version: "1.0.0"
status: open
priority: high
reason_class: response-needed
reason_detail: "[response] Reply needed"
created_at: 2026-05-04T15:00:00Z
source: slack
source_ref: "C123#456.789"
related_entities:
  - person/test-user
  - partner_platform/test-corp
due_by: 2026-05-15
snoozed_until: null
completed_at: null
dismissed_at: null
suggested_actions:
  - label: "Draft a reply"
    host_prompt: "ux: Use the agntux-slack plugin to draft a reply for action test-1."
  - label: "Snooze 24h"
    host_prompt: "ux: Use the agntux-core plugin to snooze action item test-1 for 24 hours."`,
      `## Why this matters\n\nThis is the test rationale.\n\n## Personalization fit\n\n- Matches a rule\n`,
    );

    const result = await handleTriageView({});
    const payload = asPayload(result);
    const actions = payload.actions as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(1);
    const a = actions[0];
    expect(a.id).toBe("test-1");
    expect(a.priority).toBe("high");
    expect(a.status).toBe("open");
    expect(a.reason_class).toBe("response-needed");
    expect(a.due_by).toBe("2026-05-15");
    expect(a.source).toBe("slack");
    expect(a.related_entities).toEqual([
      "person/test-user",
      "partner_platform/test-corp",
    ]);
    expect(a.suggested_actions).toEqual([
      {
        label: "Draft a reply",
        host_prompt:
          "ux: Use the agntux-slack plugin to draft a reply for action test-1.",
        url: null,
      },
      {
        label: "Snooze 24h",
        host_prompt:
          "ux: Use the agntux-core plugin to snooze action item test-1 for 24 hours.",
        url: null,
      },
    ]);
    expect(a.why_matters_excerpt).toContain("test rationale");
    expect(a.personalization_fit_excerpt).toContain("Matches a rule");
  });

  it("falls back to deriving title from why_matters when reason_detail is absent", async () => {
    writeAction(
      "no-reason",
      `id: no-reason
status: open
priority: medium`,
      `## Why this matters\n\nAlpha sentence here. Beta sentence here.\n`,
    );
    const result = await handleTriageView({});
    const a = (asPayload(result).actions as Array<Record<string, unknown>>)[0];
    expect(a.title).toBe("Alpha sentence here");
  });

  it("strips a leading [bracket] tag from reason_detail when deriving title", async () => {
    writeAction(
      "bracketed",
      `id: bracketed
status: open
priority: low
reason_detail: "[fyi] Just a note"`,
      `## Why this matters\n\nbody.\n`,
    );
    const result = await handleTriageView({});
    const a = (asPayload(result).actions as Array<Record<string, unknown>>)[0];
    expect(a.title).toBe("Just a note");
  });

  it("ignores files with unparseable YAML without crashing", async () => {
    writeAction(
      "good",
      `id: good
status: open
priority: high`,
    );
    writeFileSync(join(actionsDir, "bad.md"), "---\nthis: is: not: valid: yaml\n---\n");
    const result = await handleTriageView({});
    const actions = asPayload(result).actions as Array<Record<string, unknown>>;
    expect(actions.find((a) => a.id === "good")).toBeDefined();
    expect(actions.find((a) => a.id === "bad")).toBeUndefined();
  });

  it("skips entries whose status is unknown", async () => {
    writeAction(
      "weird-status",
      `id: weird-status
status: pending
priority: medium`,
    );
    const result = await handleTriageView({});
    const payload = asPayload(result);
    expect(payload.actions).toEqual([]);
    expect(payload.handled_recent).toEqual([]);
    expect(payload.bootstrap_mode).toBe(true);
  });
});

describe("handleTriageView — sort + handled cutoff + caps", () => {
  it("sorts open actions by priority then due_by", async () => {
    writeAction("low-1", `id: low-1\nstatus: open\npriority: low\ndue_by: 2026-05-10`);
    writeAction("high-2", `id: high-2\nstatus: open\npriority: high\ndue_by: 2026-05-20`);
    writeAction("high-1", `id: high-1\nstatus: open\npriority: high\ndue_by: 2026-05-15`);
    writeAction("med-1", `id: med-1\nstatus: open\npriority: medium\ndue_by: 2026-05-05`);

    const result = await handleTriageView({});
    const ids = (asPayload(result).actions as Array<Record<string, unknown>>).map(
      (a) => a.id,
    );
    expect(ids).toEqual(["high-1", "high-2", "med-1", "low-1"]);
  });

  it("caps actions at default limit (30) and reports counts.truncated", async () => {
    for (let i = 0; i < 35; i++) {
      writeAction(`bulk-${i}`, `id: bulk-${i}\nstatus: open\npriority: low`);
    }
    const result = await handleTriageView({});
    const payload = asPayload(result);
    expect((payload.actions as unknown[]).length).toBe(30);
    expect((payload.counts as Record<string, unknown>).truncated).toBe(true);
  });

  it("clamps limit > MAX_LIMIT (50) down to 50", async () => {
    for (let i = 0; i < 60; i++) {
      writeAction(`bulk-${i}`, `id: bulk-${i}\nstatus: open\npriority: low`);
    }
    const result = await handleTriageView({ limit: 9999 });
    const payload = asPayload(result);
    expect((payload.actions as unknown[]).length).toBe(50);
    expect((payload.counts as Record<string, unknown>).truncated).toBe(true);
  });

  it("excludes handled actions older than view_handled_days (default 7d)", async () => {
    writeAction(
      "old-done",
      `id: old-done
status: done
priority: low
completed_at: ${isoMinus(20)}`,
    );
    writeAction(
      "recent-done",
      `id: recent-done
status: done
priority: high
completed_at: ${isoMinus(2)}`,
    );
    const result = await handleTriageView({});
    const handled = asPayload(result).handled_recent as Array<
      Record<string, unknown>
    >;
    const ids = handled.map((h) => h.id);
    expect(ids).toContain("recent-done");
    expect(ids).not.toContain("old-done");
  });

  it("caps handled_recent at MAX_HANDLED_RECENT (10)", async () => {
    for (let i = 0; i < 12; i++) {
      writeAction(
        `handled-${i}`,
        `id: handled-${i}
status: done
priority: low
completed_at: ${isoMinus(1)}`,
      );
    }
    const result = await handleTriageView({});
    expect((asPayload(result).handled_recent as unknown[]).length).toBe(10);
  });

  it("respects custom view_handled_days within bounds", async () => {
    writeAction(
      "fourteen-old",
      `id: fourteen-old
status: dismissed
priority: low
dismissed_at: ${isoMinus(14)}`,
    );
    const within = await handleTriageView({ view_handled_days: 21 });
    expect(
      (asPayload(within).handled_recent as Array<Record<string, unknown>>).map(
        (h) => h.id,
      ),
    ).toContain("fourteen-old");
    const outside = await handleTriageView({ view_handled_days: 7 });
    expect(
      (asPayload(outside).handled_recent as Array<Record<string, unknown>>).map(
        (h) => h.id,
      ),
    ).not.toContain("fourteen-old");
  });

  it("clamps view_handled_days > MAX_HANDLED_DAYS (30) down to 30", async () => {
    writeAction(
      "thirty-five-old",
      `id: thirty-five-old
status: done
priority: low
completed_at: ${isoMinus(35)}`,
    );
    const result = await handleTriageView({ view_handled_days: 9999 });
    expect(
      (asPayload(result).handled_recent as Array<Record<string, unknown>>).map(
        (h) => h.id,
      ),
    ).not.toContain("thirty-five-old");
  });
});

describe("handleTriageView — payload caps + budgets", () => {
  it("truncates why_matters_excerpt to ≤600 chars", async () => {
    const long = "x".repeat(2_000);
    writeAction(
      "long-body",
      `id: long-body
status: open
priority: medium`,
      `## Why this matters\n\n${long}\n`,
    );
    const result = await handleTriageView({});
    const a = (asPayload(result).actions as Array<Record<string, unknown>>)[0];
    expect((a.why_matters_excerpt as string).length).toBeLessThanOrEqual(600);
  });

  it("caps related_entities at 6", async () => {
    writeAction(
      "many-entities",
      `id: many-entities
status: open
priority: medium
related_entities:
  - person/a
  - person/b
  - person/c
  - person/d
  - person/e
  - person/f
  - person/g
  - person/h`,
    );
    const result = await handleTriageView({});
    const a = (asPayload(result).actions as Array<Record<string, unknown>>)[0];
    expect((a.related_entities as string[]).length).toBe(6);
  });

  it("accepts a suggested_action with url-only (no host_prompt) and threads url through", async () => {
    writeAction(
      "url-only",
      `id: url-only
status: open
priority: medium
suggested_actions:
  - label: "Open in Slack"
    url: "https://oatfi.slack.com/archives/C031V2MJ2KA/p1777391863734439"
  - label: "Draft a reply"
    host_prompt: "ux: Use the agntux-slack plugin to draft a reply for action url-only."`,
    );
    const result = await handleTriageView({});
    const a = (asPayload(result).actions as Array<Record<string, unknown>>)[0];
    expect(a.suggested_actions).toEqual([
      {
        label: "Open in Slack",
        host_prompt: "",
        url: "https://oatfi.slack.com/archives/C031V2MJ2KA/p1777391863734439",
      },
      {
        label: "Draft a reply",
        host_prompt:
          "ux: Use the agntux-slack plugin to draft a reply for action url-only.",
        url: null,
      },
    ]);
  });

  it("rejects unsafe url schemes (javascript:, data:, file:) and drops the row when no host_prompt fallback", async () => {
    writeAction(
      "unsafe-url",
      `id: unsafe-url
status: open
priority: medium
suggested_actions:
  - label: "javascript scheme"
    url: "javascript:alert(1)"
  - label: "data scheme"
    url: "data:text/html,<script>alert(1)</script>"
  - label: "Open in Slack"
    url: "https://oatfi.slack.com/archives/C0/p1"
  - label: "Has chat fallback"
    url: "javascript:noop"
    host_prompt: "ux: do something"`,
    );
    const result = await handleTriageView({});
    const a = (asPayload(result).actions as Array<Record<string, unknown>>)[0];
    const sas = a.suggested_actions as Array<Record<string, unknown>>;
    // javascript: and data: rows have no host_prompt fallback -> dropped.
    // The https row survives. The "Has chat fallback" row keeps host_prompt
    // and silently nulls the unsafe url.
    expect(sas.length).toBe(2);
    expect(sas[0].label).toBe("Open in Slack");
    expect(sas[0].url).toBe("https://oatfi.slack.com/archives/C0/p1");
    expect(sas[1].label).toBe("Has chat fallback");
    expect(sas[1].url).toBeNull();
    expect(sas[1].host_prompt).toBe("ux: do something");
  });

  it("treats whitespace-only fields as absent (drops a row with no real content)", async () => {
    writeAction(
      "whitespace",
      `id: whitespace
status: open
priority: medium
suggested_actions:
  - label: "   "
    host_prompt: "real prompt"
  - label: "Real label"
    host_prompt: "   "
    url: "   "`,
    );
    const result = await handleTriageView({});
    const a = (asPayload(result).actions as Array<Record<string, unknown>>)[0];
    expect((a.suggested_actions as unknown[]).length).toBe(0);
  });

  it("drops a suggested_action row that has neither host_prompt nor url", async () => {
    writeAction(
      "label-only",
      `id: label-only
status: open
priority: medium
suggested_actions:
  - label: "Just a label"
  - label: "Open in Slack"
    url: "https://oatfi.slack.com/archives/C0/p1"`,
    );
    const result = await handleTriageView({});
    const a = (asPayload(result).actions as Array<Record<string, unknown>>)[0];
    expect((a.suggested_actions as unknown[]).length).toBe(1);
    expect(((a.suggested_actions as unknown[])[0] as { label: string }).label).toBe(
      "Open in Slack",
    );
  });

  it("caps suggested_actions at 6", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 9; i++) {
      lines.push(`  - label: "Action ${i}"\n    host_prompt: "ux: do ${i}"`);
    }
    writeAction(
      "many-suggested",
      `id: many-suggested
status: open
priority: medium
suggested_actions:
${lines.join("\n")}`,
    );
    const result = await handleTriageView({});
    const a = (asPayload(result).actions as Array<Record<string, unknown>>)[0];
    expect((a.suggested_actions as unknown[]).length).toBe(6);
  });
});

describe("handleTriageView — counts + last_updated_at + result envelope", () => {
  it("returns _meta.ui.resourceUri pointing at ui://triage", async () => {
    const result = await handleTriageView({});
    expect(result._meta.ui.resourceUri).toBe("ui://triage");
  });

  // Regression guard for the Cowork-text-render bug: the host expected the
  // deprecated flat key and silently fell back to text when it was missing.
  // The fix is to emit both keys, matching what the upstream registerAppTool
  // helper in @modelcontextprotocol/ext-apps does.
  it("descriptor _meta carries both modern and legacy resourceUri keys", async () => {
    const { triageViewTool } = await import("../src/tools/triage-view.js");
    const meta = triageViewTool._meta as {
      ui: { resourceUri: string };
      "ui/resourceUri": string;
    };
    expect(meta.ui.resourceUri).toBe("ui://triage");
    expect(meta["ui/resourceUri"]).toBe("ui://triage");
  });

  // Regression guard for the Cowork iframe-not-opening bug. Without
  // outputSchema, hosts have no contract telling them structuredContent is
  // iframe payload (vs. chat-surfaceable data); Cowork falls back to
  // text-rendering structuredContent. The fix mirrors the official
  // ext-apps `scenario-modeler-server` example and the app project's
  // c023186 fix.
  it("descriptor declares outputSchema covering success + error shapes", async () => {
    const { triageViewTool } = await import("../src/tools/triage-view.js");
    const schema = triageViewTool.outputSchema as {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeDefined();
    for (const key of [
      "actions",
      "handled_recent",
      "counts",
      "last_updated_at",
      "bootstrap_mode",
      "error",
    ]) {
      expect(schema.properties[key]).toBeDefined();
    }
    // No `required` — the structured-error envelope `{error: ...}` must
    // also validate against this schema.
    expect(schema.required ?? []).toEqual([]);
  });

  it("counts open + snoozed independently", async () => {
    writeAction("o-1", `id: o-1\nstatus: open\npriority: high`);
    writeAction("o-2", `id: o-2\nstatus: open\npriority: medium`);
    writeAction(
      "s-1",
      `id: s-1\nstatus: snoozed\npriority: low\nsnoozed_until: ${isoMinus(-2)}`,
    );
    const result = await handleTriageView({});
    const counts = asPayload(result).counts as Record<string, unknown>;
    expect(counts.open).toBe(2);
    expect(counts.snoozed).toBe(1);
  });

  it("emits last_updated_at as a non-empty ISO-shaped string", async () => {
    writeAction("a", `id: a\nstatus: open\npriority: low`);
    const result = await handleTriageView({});
    const last = asPayload(result).last_updated_at as string;
    expect(typeof last).toBe("string");
    expect(last).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
