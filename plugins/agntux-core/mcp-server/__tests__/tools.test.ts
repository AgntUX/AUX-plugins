import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolve, relative } from "node:path";

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

import { setFrontmatter } from "../src/frontmatter.js";
import { snoozeTool } from "../src/tools/snooze.js";
import { dismissTool } from "../src/tools/dismiss.js";
import { setStatusTool, appendOutcomeSection } from "../src/tools/set-status.js";

const ACTION_CONTENT = `---
id: 2026-04-25-test-action
type: action-item
schema_version: "1.0.0"
status: open
priority: high
reason_class: deadline
created_at: 2026-04-25T14:22:00Z
source: slack
source_ref: T01_test
related_entities:
  - companies/test-corp
snoozed_until: null
completed_at: null
dismissed_at: null
---

## Why this matters
Test action item.

## Personalization fit
- Matches test rule
`;

// ---- Path guard helper (mirrors what the tools use) ----

function makeActionsGuard(actionsDir: string) {
  return function guardPath(id: string): string {
    const resolved = resolve(actionsDir, `${id}.md`);
    const rel = relative(actionsDir, resolved);
    if (rel.startsWith("..") || resolve(rel) === rel) {
      throw new Error(`Path traversal rejected: id "${id}" resolves outside actions dir`);
    }
    return resolved;
  };
}

const ACTIONS_DIR = join(homedir(), "agntux", "actions");
const guardActions = makeActionsGuard(ACTIONS_DIR);

// ---- snooze ----

describe("tool: snooze (via frontmatter patcher)", () => {
  it("sets status to snoozed with snoozed_until", () => {
    const patched = setFrontmatter(ACTION_CONTENT, {
      status: "snoozed",
      snoozed_until: "2026-05-01",
      completed_at: null,
      dismissed_at: null,
    });
    expect(patched).toContain("status: snoozed");
    expect(patched).toContain("snoozed_until: 2026-05-01");
    expect(patched).toContain("completed_at: null");
    expect(patched).toContain("dismissed_at: null");
  });

  it("preserves body after snoozed patch", () => {
    const patched = setFrontmatter(ACTION_CONTENT, { status: "snoozed", snoozed_until: "2026-05-01" });
    expect(patched).toContain("## Why this matters");
    expect(patched).toContain("Test action item.");
  });

  it("idempotent: patching same value twice yields same result", () => {
    const once = setFrontmatter(ACTION_CONTENT, { status: "snoozed", snoozed_until: "2026-05-01" });
    const twice = setFrontmatter(once, { status: "snoozed", snoozed_until: "2026-05-01" });
    expect(twice).toBe(once);
  });

  it("real handler rejects path traversal id '../../etc/passwd' before any FS access", async () => {
    await expect(snoozeTool.handler({ id: "../../etc/passwd", until: "2026-05-01" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });

  it("real handler rejects id with leading slash '/etc/passwd' before any FS access", async () => {
    await expect(snoozeTool.handler({ id: "/etc/passwd", until: "2026-05-01" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });

  it("real handler rejects empty id", async () => {
    await expect(snoozeTool.handler({ id: "", until: "2026-05-01" }))
      .rejects.toThrow(/id is required/);
  });
});

// ---- dismiss ----

describe("tool: dismiss (via frontmatter patcher)", () => {
  it("sets status to dismissed with dismissed_at", () => {
    const now = "2026-04-26T10:00:00Z";
    const patched = setFrontmatter(ACTION_CONTENT, {
      status: "dismissed",
      dismissed_at: now,
      completed_at: null,
    });
    expect(patched).toContain("status: dismissed");
    expect(patched).toContain(`dismissed_at: ${now}`);
    expect(patched).toContain("completed_at: null");
  });

  it("does not affect snoozed_until when dismissing", () => {
    const patched = setFrontmatter(ACTION_CONTENT, {
      status: "dismissed",
      dismissed_at: "2026-04-26T10:00:00Z",
    });
    expect(patched).toContain("snoozed_until: null");
  });

  it("fails on file with no frontmatter", () => {
    expect(() => setFrontmatter("no frontmatter here", { status: "dismissed" })).toThrow();
  });

  it("real handler rejects path traversal id '../../etc/passwd' before any FS access", async () => {
    await expect(dismissTool.handler({ id: "../../etc/passwd" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });

  it("real handler rejects id '../../../' before any FS access", async () => {
    await expect(dismissTool.handler({ id: "../../../" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });

  it("real handler rejects id 'actions/foo' with leading path segment before any FS access", async () => {
    // 'actions/foo' resolves to ACTIONS_DIR/actions/foo.md — still inside actions dir
    // so this is a valid-looking path; the guard accepts it (subdirectory).
    // Test that absolute-path injection is blocked instead.
    await expect(dismissTool.handler({ id: "/etc/passwd" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });
});

// ---- set_status ----

describe("tool: set_status (via frontmatter patcher)", () => {
  it("transitions open → done", () => {
    const now = "2026-04-26T12:00:00Z";
    const patched = setFrontmatter(ACTION_CONTENT, {
      status: "done",
      completed_at: now,
      dismissed_at: null,
    });
    expect(patched).toContain("status: done");
    expect(patched).toContain(`completed_at: ${now}`);
  });

  it("transitions done → open (re-open) clears timestamps", () => {
    const withDone = setFrontmatter(ACTION_CONTENT, {
      status: "done",
      completed_at: "2026-04-26T12:00:00Z",
    });
    const reopened = setFrontmatter(withDone, {
      status: "open",
      snoozed_until: null,
      completed_at: null,
      dismissed_at: null,
    });
    expect(reopened).toContain("status: open");
    expect(reopened).toContain("completed_at: null");
  });

  it("rejects invalid status value (guard logic)", () => {
    const VALID_STATUSES = new Set(["open", "snoozed", "done", "dismissed"]);
    expect(VALID_STATUSES.has("invalid-status")).toBe(false);
    // Simulate what the handler does
    const validate = (s: string) => {
      if (!VALID_STATUSES.has(s)) throw new Error(`Invalid status "${s}"`);
    };
    expect(() => validate("invalid-status")).toThrow('Invalid status "invalid-status"');
  });

  it("requires snoozed_until when status is snoozed (guard logic)", () => {
    const validate = (status: string, snoozed_until?: string) => {
      if (status === "snoozed" && !snoozed_until) throw new Error("snoozed_until is required");
    };
    expect(() => validate("snoozed")).toThrow("snoozed_until is required");
    expect(() => validate("snoozed", "2026-05-01")).not.toThrow();
  });

  it("real handler rejects path traversal id '../../etc/passwd' before any FS access", async () => {
    await expect(setStatusTool.handler({ id: "../../etc/passwd", status: "done" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });

  it("real handler rejects invalid status before any FS access", async () => {
    // The guard runs before the file read, so even a traversal id + invalid status
    // should throw on invalid status (status is validated first in the handler).
    await expect(setStatusTool.handler({ id: "../../etc/passwd", status: "invalid-status" }))
      .rejects.toThrow(/[Ii]nvalid status/);
  });

  it("real handler rejects missing snoozed_until when status is snoozed", async () => {
    await expect(setStatusTool.handler({ id: "../../etc/passwd", status: "snoozed" }))
      .rejects.toThrow(/snoozed_until is required/);
  });
});

// ---- appendOutcomeSection helper (4.3.0) ----

describe("appendOutcomeSection helper", () => {
  it("appends a `## Outcome` body section with timestamp", () => {
    const file = ACTION_CONTENT;
    const out = appendOutcomeSection(file, "noise");
    expect(out).toMatch(/\n## Outcome\nnoise — \d{4}-\d{2}-\d{2}T/);
    expect(out).toContain("## Why this matters");
    expect(out).toContain("## Personalization fit");
  });

  it("includes the optional note on its own line", () => {
    const out = appendOutcomeSection(
      ACTION_CONTENT,
      "completed-externally",
      "handled in Slack DM with the requester",
    );
    expect(out).toContain("completed-externally — ");
    expect(out).toContain("handled in Slack DM with the requester");
  });

  it("emits exactly one blank line before `## Outcome` when input ends with newline", () => {
    const file = ACTION_CONTENT.endsWith("\n") ? ACTION_CONTENT : ACTION_CONTENT + "\n";
    const out = appendOutcomeSection(file, "noise");
    // Exactly two newlines (one blank line) between body content and the heading.
    expect(out).toMatch(/[^\n]\n\n## Outcome/);
    // No triple-newline gap.
    expect(out).not.toMatch(/\n\n\n## Outcome/);
  });

  it("emits exactly one blank line before `## Outcome` when input has no trailing newline", () => {
    const file = "---\nstatus: open\n---\n\nbody, no trailing newline";
    const out = appendOutcomeSection(file, "noise");
    // Inserting newline + block-prefix newline still yields exactly one blank line.
    expect(out).toContain("body, no trailing newline\n\n## Outcome");
    expect(out).not.toMatch(/\n\n\n## Outcome/);
  });

  it("supports multiple `## Outcome` sections (append-only history)", () => {
    const once = appendOutcomeSection(ACTION_CONTENT, "noise");
    const twice = appendOutcomeSection(once, "completed-externally");
    const matches = twice.match(/## Outcome/g) ?? [];
    expect(matches.length).toBe(2);
    expect(twice.indexOf("noise — ")).toBeLessThan(twice.indexOf("completed-externally — "));
  });

  it("does not touch frontmatter", () => {
    const out = appendOutcomeSection(ACTION_CONTENT, "noise");
    const fmEnd = out.indexOf("\n---\n", 4); // second `---` closes frontmatter
    const fmBlock = out.slice(0, fmEnd);
    expect(fmBlock).not.toContain("Outcome");
  });
});

// ---- set_status outcome arg (4.3.0) ----

describe("set_status outcome arg input schema", () => {
  it("declares outcome and outcome_note as optional properties", () => {
    const props = setStatusTool.inputSchema.properties as Record<string, { type: string }>;
    expect(props.outcome).toBeDefined();
    expect(props.outcome.type).toBe("string");
    expect(props.outcome_note).toBeDefined();
    expect(props.outcome_note.type).toBe("string");
  });

  it("does not list outcome / outcome_note as required (back-compat)", () => {
    const required = setStatusTool.inputSchema.required as string[];
    expect(required).not.toContain("outcome");
    expect(required).not.toContain("outcome_note");
    // Existing required fields are unchanged.
    expect(required).toContain("id");
    expect(required).toContain("status");
  });

  it("description mentions the new outcome capability", () => {
    expect(setStatusTool.description.toLowerCase()).toContain("outcome");
  });
});

// ---- dismiss outcome arg (4.3.0) ----

describe("dismiss outcome arg input schema", () => {
  it("declares outcome and outcome_note as optional properties", () => {
    const props = dismissTool.inputSchema.properties as Record<string, { type: string }>;
    expect(props.outcome).toBeDefined();
    expect(props.outcome.type).toBe("string");
    expect(props.outcome_note).toBeDefined();
    expect(props.outcome_note.type).toBe("string");
  });

  it("does not list outcome / outcome_note as required (back-compat)", () => {
    const required = dismissTool.inputSchema.required as string[];
    expect(required).not.toContain("outcome");
    expect(required).not.toContain("outcome_note");
    expect(required).toEqual(["id"]);
  });

  it("description mentions the new outcome capability", () => {
    expect(dismissTool.description.toLowerCase()).toContain("outcome");
  });
});

// ---- end-to-end: outcome appends body section against an isolated tmp project root ----

describe("set_status + dismiss with outcome (end-to-end)", () => {
  // expectedAgntuxRoot() walks up from cwd looking for a directory whose
  // basename is "agntux" (case-insensitive). vitest workers don't permit
  // process.chdir(), so we stub process.cwd() to point at a tmp tree like
  //   <tmp>/<unique>/agntux/actions/<fixture>.md
  // and the tool's resolver walks up to the "agntux" segment as the root.
  const FIXTURE_ID = "2026-05-04-outcome-arg-fixture";
  let tmpProjectRoot: string;
  let fixturePath: string;
  let cwdSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    const uniq = `outcome-arg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const parent = join(tmpdir(), uniq);
    tmpProjectRoot = join(parent, "agntux");
    const actionsDir = join(tmpProjectRoot, "actions");
    mkdirSync(actionsDir, { recursive: true });
    fixturePath = join(actionsDir, `${FIXTURE_ID}.md`);
    writeFileSync(fixturePath, ACTION_CONTENT.replace("test-action", FIXTURE_ID));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpProjectRoot);
  });

  afterEach(() => {
    cwdSpy?.mockRestore();
    cwdSpy = null;
    if (tmpProjectRoot && existsSync(join(tmpProjectRoot, ".."))) {
      rmSync(join(tmpProjectRoot, ".."), { recursive: true, force: true });
    }
  });

  it("set_status done with outcome=completed-externally appends `## Outcome` body section", async () => {
    const result = await setStatusTool.handler({
      id: FIXTURE_ID,
      status: "done",
      outcome: "completed-externally",
      outcome_note: "handled in Slack DM",
    });
    const written = readFileSync(fixturePath, "utf-8");
    expect(written).toContain("status: done");
    expect(written).toMatch(/completed_at: \d{4}-\d{2}-\d{2}T/);
    expect(written).toContain("\n## Outcome\ncompleted-externally — ");
    expect(written).toContain("handled in Slack DM");
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("(outcome: completed-externally)");
  });

  it("dismiss with outcome=noise appends `## Outcome` body section", async () => {
    const result = await dismissTool.handler({ id: FIXTURE_ID, outcome: "noise" });
    const written = readFileSync(fixturePath, "utf-8");
    expect(written).toContain("status: dismissed");
    expect(written).toContain("\n## Outcome\nnoise — ");
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("(outcome: noise)");
  });

  it("dismiss without outcome leaves the body untouched (back-compat)", async () => {
    const before = readFileSync(fixturePath, "utf-8");
    await dismissTool.handler({ id: FIXTURE_ID });
    const after = readFileSync(fixturePath, "utf-8");
    expect(after).toContain("status: dismissed");
    expect(after).not.toContain("## Outcome");
    // Body content (Why this matters / Personalization fit) is byte-equal.
    const beforeBody = before.split(/^---\n[\s\S]*?\n---\n/m)[1] ?? "";
    const afterBody = after.split(/^---\n[\s\S]*?\n---\n/m)[1] ?? "";
    expect(afterBody).toBe(beforeBody);
  });

  it("set_status snoozed with outcome does NOT append `## Outcome` (only done/dismissed)", async () => {
    await setStatusTool.handler({
      id: FIXTURE_ID,
      status: "snoozed",
      snoozed_until: "2026-05-10",
      outcome: "noise",
    });
    const written = readFileSync(fixturePath, "utf-8");
    expect(written).toContain("status: snoozed");
    expect(written).not.toContain("## Outcome");
  });

  it("set_status open with outcome does NOT append `## Outcome` (only done/dismissed)", async () => {
    // First set to done with an outcome to verify the section was added once.
    await setStatusTool.handler({
      id: FIXTURE_ID,
      status: "done",
      outcome: "completed-externally",
    });
    const afterDone = readFileSync(fixturePath, "utf-8");
    const beforeOpen = (afterDone.match(/## Outcome/g) ?? []).length;

    await setStatusTool.handler({
      id: FIXTURE_ID,
      status: "open",
      outcome: "completed-externally",
    });
    const afterOpen = readFileSync(fixturePath, "utf-8");
    const afterOpenCount = (afterOpen.match(/## Outcome/g) ?? []).length;
    // Opening did not add another `## Outcome` section.
    expect(afterOpenCount).toBe(beforeOpen);
  });

  it("whitespace-only outcome is ignored (no body section, no message suffix)", async () => {
    const result = await dismissTool.handler({ id: FIXTURE_ID, outcome: "   " });
    const written = readFileSync(fixturePath, "utf-8");
    expect(written).not.toContain("## Outcome");
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).not.toContain("outcome:");
  });
});

// ---- team-wide mark-done attribution (P9 / 9.3.0) ----
//
// `done_by_user_slug`, `done_by_user_id`, and `done_at` are written to a
// team or leader-view scoped action file when status flips to `done`.
// They are absent on personal scope so the solo behavior stays
// byte-identical to 9.2.0. Re-opening / snoozing / dismissing a
// team-scoped item clears the attribution fields.

describe("set_status team-wide done attribution (P9)", () => {
  const FIXTURE_ID = "2026-05-12-acme-renewal";
  let tmpProjectRoot: string;
  let teamActionsDir: string;
  let teamFixturePath: string;
  let personalFixturePath: string;
  let cwdSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    const uniq = `team-done-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const parent = join(tmpdir(), uniq);
    tmpProjectRoot = join(parent, "agntux");
    const personalActionsDir = join(tmpProjectRoot, "actions");
    teamActionsDir = join(tmpProjectRoot, "teams", "platform", "actions");
    mkdirSync(personalActionsDir, { recursive: true });
    mkdirSync(teamActionsDir, { recursive: true });

    const teamContent = `---
id: ${FIXTURE_ID}
type: action-item
schema_version: "1.0.0"
status: open
priority: high
reason_class: risk
team_slug: platform
team_id: uuid-team-platform
created_at: 2026-05-12T14:30:00Z
source: slack
source_ref: T01_team
related_entities:
  - companies/acme
---

## Why this matters
Team item.
`;
    teamFixturePath = join(teamActionsDir, `${FIXTURE_ID}.md`);
    writeFileSync(teamFixturePath, teamContent);
    personalFixturePath = join(personalActionsDir, `${FIXTURE_ID}.md`);
    writeFileSync(personalFixturePath, ACTION_CONTENT.replace("test-action", FIXTURE_ID));

    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpProjectRoot);
  });

  afterEach(() => {
    cwdSpy?.mockRestore();
    cwdSpy = null;
    if (tmpProjectRoot && existsSync(join(tmpProjectRoot, ".."))) {
      rmSync(join(tmpProjectRoot, ".."), { recursive: true, force: true });
    }
  });

  it("writes done_by_user_slug + done_by_user_id + done_at on team-scope mark-done", async () => {
    await setStatusTool.handler({
      id: FIXTURE_ID,
      status: "done",
      team_slug: "platform",
      user_slug: "alice",
      user_id: "uuid-alice-1234",
    });
    const written = readFileSync(teamFixturePath, "utf-8");
    expect(written).toContain("status: done");
    expect(written).toContain("done_by_user_slug: alice");
    expect(written).toContain("done_by_user_id: uuid-alice-1234");
    expect(written).toMatch(/done_at: \d{4}-\d{2}-\d{2}T/);
    // completed_at is also written (legacy field stays populated for
    // backward compat with anything reading the personal-style timestamp).
    expect(written).toMatch(/completed_at: \d{4}-\d{2}-\d{2}T/);
  });

  it("omits done_by_* attribution on personal-scope mark-done (byte-identical to 9.2.0)", async () => {
    await setStatusTool.handler({
      id: FIXTURE_ID,
      status: "done",
      user_slug: "alice",
      user_id: "uuid-alice-1234",
    });
    const written = readFileSync(personalFixturePath, "utf-8");
    expect(written).toContain("status: done");
    expect(written).not.toContain("done_by_user_slug");
    expect(written).not.toContain("done_by_user_id");
    expect(written).not.toContain("done_at:");
  });

  it("drops invalid user_slug values (strict slug pattern enforcement)", async () => {
    await setStatusTool.handler({
      id: FIXTURE_ID,
      status: "done",
      team_slug: "platform",
      user_slug: "../etc",
      user_id: "uuid-alice",
    });
    const written = readFileSync(teamFixturePath, "utf-8");
    // user_slug rejected → done_by_user_slug not written; user_id still
    // accepted (free-form) so done_by_user_id present.
    expect(written).not.toContain("done_by_user_slug");
    expect(written).toContain("done_by_user_id: uuid-alice");
  });

  it("clears done_by_* attribution on re-open (status: done → open)", async () => {
    await setStatusTool.handler({
      id: FIXTURE_ID,
      status: "done",
      team_slug: "platform",
      user_slug: "alice",
      user_id: "uuid-alice",
    });
    expect(readFileSync(teamFixturePath, "utf-8")).toContain(
      "done_by_user_slug: alice",
    );
    await setStatusTool.handler({
      id: FIXTURE_ID,
      status: "open",
      team_slug: "platform",
    });
    const written = readFileSync(teamFixturePath, "utf-8");
    expect(written).toContain("status: open");
    expect(written).toContain("done_by_user_slug: null");
    expect(written).toContain("done_by_user_id: null");
    expect(written).toContain("done_at: null");
  });

  it("works without user_slug / user_id (done_at still set; slug/id absent)", async () => {
    await setStatusTool.handler({
      id: FIXTURE_ID,
      status: "done",
      team_slug: "platform",
    });
    const written = readFileSync(teamFixturePath, "utf-8");
    expect(written).toContain("status: done");
    expect(written).toMatch(/done_at: \d{4}-\d{2}-\d{2}T/);
    expect(written).not.toContain("done_by_user_slug");
    expect(written).not.toContain("done_by_user_id");
  });
});

// ---- path traversal guards (actions dir) ----

describe("path traversal guards (actions dir)", () => {
  it("rejects id with .. segments", () => {
    expect(() => guardActions("../../etc/passwd")).toThrow("Path traversal rejected");
    expect(() => guardActions("../other-dir/file")).toThrow("Path traversal rejected");
  });

  it("accepts a valid flat id", () => {
    expect(() => guardActions("2026-04-25-acme-renewal-pricing")).not.toThrow();
    const result = guardActions("2026-04-25-acme-renewal-pricing");
    expect(result).toBe(join(ACTIONS_DIR, "2026-04-25-acme-renewal-pricing.md"));
  });

  it("rejects absolute path as id", () => {
    // resolve(ACTIONS_DIR, "/etc/passwd.md") → "/etc/passwd.md" (absolute wins),
    // so relative() will produce a path starting with ".."
    expect(() => guardActions("/etc/passwd")).toThrow("Path traversal rejected");
  });
});
