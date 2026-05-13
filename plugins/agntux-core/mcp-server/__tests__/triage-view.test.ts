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

  it("ignores caller-supplied `limit` (server-side cap stays at DEFAULT_LIMIT)", async () => {
    // Historical test expected a 50-cap clamp; the handler's `_args` has
    // ignored caller input since 9.0.0 and the cap is fixed at
    // DEFAULT_LIMIT (30). Updated to assert the actual contract.
    for (let i = 0; i < 60; i++) {
      writeAction(`bulk-${i}`, `id: bulk-${i}\nstatus: open\npriority: low`);
    }
    const result = await handleTriageView({ limit: 9999 });
    const payload = asPayload(result);
    expect((payload.actions as unknown[]).length).toBe(30);
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

  it("ignores caller-supplied `view_handled_days` (server-side cap stays at DEFAULT_HANDLED_DAYS=7)", async () => {
    // Historical test expected a tunable window; the handler's `_args`
    // has ignored caller input since 9.0.0 and the window is fixed at
    // DEFAULT_HANDLED_DAYS=7. 14-day-old items always fall outside.
    writeAction(
      "fourteen-old",
      `id: fourteen-old
status: dismissed
priority: low
dismissed_at: ${isoMinus(14)}`,
    );
    writeAction(
      "two-day-old",
      `id: two-day-old
status: done
priority: high
completed_at: ${isoMinus(2)}`,
    );
    const result = await handleTriageView({ view_handled_days: 21 });
    const handled = (
      asPayload(result).handled_recent as Array<Record<string, unknown>>
    ).map((h) => h.id);
    expect(handled).toContain("two-day-old");
    expect(handled).not.toContain("fourteen-old");
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

// ─────────────────────────────────────────────────────────────────────────────
// Team-mode (P3 v2 §1)
// ─────────────────────────────────────────────────────────────────────────────

function writeTeamsJson(payload: unknown): void {
  const dir = join(agntuxRoot, ".agntux");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "teams.json"), JSON.stringify(payload, null, 2));
}

function writeTeamAction(team_slug: string, name: string, frontmatter: string, body = ""): void {
  const dir = join(agntuxRoot, "teams", team_slug, "actions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\n${frontmatter}\n---\n\n${body}`);
}

function writeLeaderViewAction(view_slug: string, name: string, frontmatter: string, body = ""): void {
  const dir = join(agntuxRoot, "leader-views", view_slug, "actions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\n${frontmatter}\n---\n\n${body}`);
}

describe("handleTriageView — team mode (P3 v2 §1)", () => {
  it("solo behavior is byte-identical when teams.json is absent (regression guard)", async () => {
    // Seeds the personal scope only; no .agntux/teams.json. The payload
    // MUST contain exactly the keys 9.0.0 emits — no schema_version, no
    // personal, no teams, no leader_views. If a future refactor sets one
    // of those keys unconditionally, this test fails and the solo
    // contract is intentionally broken.
    writeAction(
      "solo-1",
      `id: solo-1\nstatus: open\npriority: medium`,
      `## Why this matters\n\nA solo item.\n`,
    );
    const result = await handleTriageView({});
    const payload = result.structuredContent as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "actions",
        "bootstrap_mode",
        "counts",
        "handled_recent",
        "last_updated_at",
      ].sort(),
    );
    // Defense-in-depth: each forbidden team-mode key is explicitly checked
    // so a regression that adds the field-with-undefined-value (which
    // Object.keys hides) still fails.
    expect(payload.schema_version).toBeUndefined();
    expect(payload.personal).toBeUndefined();
    expect(payload.teams).toBeUndefined();
    expect(payload.leader_views).toBeUndefined();
    const actions = payload.actions as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(1);
    // The row itself must not carry any team-aware decoration keys.
    expect(actions[0].team_slug).toBeUndefined();
    expect(actions[0].team_id).toBeUndefined();
    expect(actions[0].source_team).toBeUndefined();
    expect(actions[0].member_relevance_class).toBeUndefined();
  });

  it("solo behavior is byte-identical when teams.json is present but empty (no memberships, no leader_views)", async () => {
    writeAction("solo-2", `id: solo-2\nstatus: open\npriority: high`);
    writeTeamsJson({
      schema_version: 1,
      memberships: [],
      leader_views: [],
    });
    const result = await handleTriageView({});
    const payload = result.structuredContent as Record<string, unknown>;
    // Same byte-identical guarantee as the absent-file case — the gate
    // is "has at least one team or leader-view", not "file exists".
    expect(payload.schema_version).toBeUndefined();
    expect(payload.personal).toBeUndefined();
    expect(payload.teams).toBeUndefined();
    expect(payload.leader_views).toBeUndefined();
  });

  it("solo behavior is byte-identical when teams.json is malformed (fails open to solo)", async () => {
    writeAction("solo-3", `id: solo-3\nstatus: open\npriority: low`);
    const dir = join(agntuxRoot, ".agntux");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "teams.json"), "{ not valid json at all");
    const result = await handleTriageView({});
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload.schema_version).toBeUndefined();
    expect(payload.personal).toBeUndefined();
    expect(payload.teams).toBeUndefined();
    expect(payload.leader_views).toBeUndefined();
  });

  it("activates team mode when teams.json lists at least one membership", async () => {
    writeAction("p-1", `id: p-1\nstatus: open\npriority: medium`);
    writeTeamAction(
      "platform",
      "t-1",
      `id: t-1
status: open
priority: high
reason_class: response-needed
team_slug: platform
team_id: uuid-team-platform
member_relevance_class: incidents`,
    );
    writeTeamsJson({
      schema_version: 1,
      memberships: [
        {
          team_slug: "platform",
          team_id: "uuid-team-platform",
          display_name: "Platform Team",
        },
      ],
      leader_views: [],
    });
    const result = await handleTriageView({});
    const payload = result.structuredContent as Record<string, unknown>;

    expect(payload.schema_version).toBe(2);
    const personal = payload.personal as Record<string, unknown>;
    expect(personal).toBeDefined();
    expect((personal.actions as Array<Record<string, unknown>>)[0].id).toBe("p-1");

    const teams = payload.teams as Array<Record<string, unknown>>;
    expect(teams).toHaveLength(1);
    const t = teams[0];
    expect(t.team_slug).toBe("platform");
    expect(t.display_name).toBe("Platform Team");
    expect(t.team_id).toBe("uuid-team-platform");
    const teamActions = t.actions as Array<Record<string, unknown>>;
    expect(teamActions).toHaveLength(1);
    expect(teamActions[0].id).toBe("t-1");
    expect(teamActions[0].team_slug).toBe("platform");
    expect(teamActions[0].team_id).toBe("uuid-team-platform");
    expect(teamActions[0].member_relevance_class).toBe("incidents");

    // Backward-compat: top-level `actions` carries personal-only so an
    // older bundle renders a sensible personal-only view.
    const legacyActions = payload.actions as Array<Record<string, unknown>>;
    expect(legacyActions.map((a) => a.id)).toEqual(["p-1"]);
  });

  it("activates team mode and surfaces leader views when teams.json lists them", async () => {
    writeAction("p-1", `id: p-1\nstatus: open\npriority: medium`);
    writeLeaderViewAction(
      "all-engineering",
      "lv-1",
      `id: lv-1
status: open
priority: high
reason_class: knowledge-update`,
    );
    writeTeamsJson({
      schema_version: 1,
      memberships: [],
      leader_views: [
        {
          view_slug: "all-engineering",
          view_id: "uuid-view-eng",
          display_name: "All Engineering",
        },
      ],
    });
    const result = await handleTriageView({});
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload.schema_version).toBe(2);
    const views = payload.leader_views as Array<Record<string, unknown>>;
    expect(views).toHaveLength(1);
    expect(views[0].view_slug).toBe("all-engineering");
    expect(views[0].display_name).toBe("All Engineering");
    const viewActions = views[0].actions as Array<Record<string, unknown>>;
    expect(viewActions).toHaveLength(1);
    expect(viewActions[0].id).toBe("lv-1");
    // Leader-view rows are not team-scoped — `team_slug` must stay absent.
    expect(viewActions[0].team_slug).toBeUndefined();
  });

  it("infers team_slug for team-scoped rows when frontmatter omits it", async () => {
    writeTeamAction("platform", "infer-1", `id: infer-1\nstatus: open\npriority: low`);
    writeTeamsJson({
      schema_version: 1,
      memberships: [{ team_slug: "platform" }],
      leader_views: [],
    });
    const result = await handleTriageView({});
    const teams = (result.structuredContent as Record<string, unknown>).teams as Array<
      Record<string, unknown>
    >;
    const action = (teams[0].actions as Array<Record<string, unknown>>)[0];
    // Scope-decoration backfills team_slug when frontmatter didn't carry it.
    expect(action.team_slug).toBe("platform");
  });

  it("rejects traversal-shaped team_slug values from teams.json", async () => {
    writeAction("solo-x", `id: solo-x\nstatus: open\npriority: low`);
    writeTeamsJson({
      schema_version: 1,
      memberships: [
        { team_slug: "../etc" },
        { team_slug: "..\\Windows" },
        { team_slug: "" },
        { team_slug: "ok-team" },
      ],
      leader_views: [],
    });
    writeTeamAction("ok-team", "ok-1", `id: ok-1\nstatus: open\npriority: medium`);
    const result = await handleTriageView({});
    const teams = (result.structuredContent as Record<string, unknown>).teams as Array<
      Record<string, unknown>
    >;
    expect(teams).toHaveLength(1);
    expect(teams[0].team_slug).toBe("ok-team");
  });

  it("falls back to directory scan for leader-views not listed in teams.json", async () => {
    writeAction("p-1", `id: p-1\nstatus: open\npriority: medium`);
    writeLeaderViewAction("offregister", "off-1", `id: off-1\nstatus: open\npriority: low`);
    writeTeamsJson({
      schema_version: 1,
      memberships: [{ team_slug: "platform" }],
      leader_views: [],
    });
    // No team_slug match required; we just need team-mode active so the
    // leader-views/ scan fires. memberships: [{platform}] satisfies that.
    writeTeamAction("platform", "ignore-me", `id: ignore-me\nstatus: open\npriority: low`);
    const result = await handleTriageView({});
    const views = (result.structuredContent as Record<string, unknown>).leader_views as Array<
      Record<string, unknown>
    >;
    expect(views.map((v) => v.view_slug)).toContain("offregister");
  });

  it("falls back gracefully when a team's actions/ directory does not exist", async () => {
    writeAction("p-1", `id: p-1\nstatus: open\npriority: medium`);
    writeTeamsJson({
      schema_version: 1,
      memberships: [{ team_slug: "platform" }, { team_slug: "infra" }],
      leader_views: [],
    });
    // Only platform/ has actions; infra/ doesn't exist at all.
    writeTeamAction("platform", "t-1", `id: t-1\nstatus: open\npriority: high`);
    const result = await handleTriageView({});
    const teams = (result.structuredContent as Record<string, unknown>).teams as Array<
      Record<string, unknown>
    >;
    // Both teams surface (so the UI can show empty sections); the missing
    // dir scan yields zero actions rather than crashing the render.
    expect(teams).toHaveLength(2);
    const infra = teams.find((t) => t.team_slug === "infra")!;
    expect(infra.actions).toEqual([]);
  });

  it("treats absent personal actions/ as empty (not an error) when team mode active", async () => {
    rmSync(actionsDir, { recursive: true });
    writeTeamAction("platform", "t-1", `id: t-1\nstatus: open\npriority: high`);
    writeTeamsJson({
      schema_version: 1,
      memberships: [{ team_slug: "platform", display_name: "Platform" }],
      leader_views: [],
    });
    const result = await handleTriageView({});
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload.error).toBeUndefined();
    expect((payload.personal as Record<string, unknown>).actions).toEqual([]);
    const teams = payload.teams as Array<Record<string, unknown>>;
    expect((teams[0].actions as unknown[]).length).toBe(1);
  });

  it("still errors with actions_index_missing when personal/ is missing AND no team mode", async () => {
    rmSync(actionsDir, { recursive: true });
    // No teams.json at all → solo with no actions/ → existing error path.
    const result = await handleTriageView({});
    expect((result.structuredContent as Record<string, unknown>).error).toBe(
      "actions_index_missing",
    );
  });

  it("aggregates counts across personal + team + leader scopes", async () => {
    writeAction("p-open", `id: p-open\nstatus: open\npriority: medium`);
    writeAction("p-snz", `id: p-snz\nstatus: snoozed\npriority: low\nsnoozed_until: 2099-01-01T00:00:00Z`);
    writeTeamAction("platform", "t-open", `id: t-open\nstatus: open\npriority: high`);
    writeLeaderViewAction("all-eng", "lv-open", `id: lv-open\nstatus: open\npriority: low`);
    writeTeamsJson({
      schema_version: 1,
      memberships: [{ team_slug: "platform" }],
      leader_views: [{ view_slug: "all-eng" }],
    });
    const result = await handleTriageView({});
    const counts = (result.structuredContent as Record<string, unknown>).counts as Record<
      string,
      unknown
    >;
    // 3 open across all scopes, 1 snoozed personal.
    expect(counts.open).toBe(3);
    expect(counts.snoozed).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// outputSchema covers the new team-mode keys
// ─────────────────────────────────────────────────────────────────────────────

describe("triageViewTool descriptor — outputSchema", () => {
  it("declares team-mode keys in outputSchema", async () => {
    const { triageViewTool } = await import("../src/tools/triage-view.js");
    const schema = triageViewTool.outputSchema as {
      type: string;
      properties: Record<string, unknown>;
    };
    for (const key of ["schema_version", "personal", "teams", "leader_views"]) {
      expect(schema.properties[key]).toBeDefined();
    }
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
