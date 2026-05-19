/**
 * End-to-end tests for the agntux-core mutation tools, exercised against
 * a real local-fs ViewToolContext. The tools' production target is the
 * S3-backed context in app/; the local-fs context shares the same write
 * surface contract so behaviour is byte-identical.
 *
 * Pinned behaviours:
 *   - snooze: status=snoozed, snoozed_until set, completed_at/dismissed_at cleared
 *   - dismiss: status=dismissed, dismissed_at set, optional `## Outcome` block appended
 *   - set-status: full state machine — open/done/dismissed/snoozed; team-scoped
 *     done sets done_by_user_slug/_id/_at
 *   - save_triage_prefs: merge semantics over the v2 schema; legacy
 *     muted_team_slugs translated to team_filters[slug] = 'hidden'
 *   - set_triage_pref: per-path patch; both-null clears the entry; path
 *     traversal is rejected
 *   - Path traversal rejection on action ids
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalFsContext } from "@agntux/plugin-runtime/local-fs";
import type { ViewToolContext } from "@agntux/plugin-runtime";
import { snoozeTool } from "../../tools/snooze";
import { dismissTool } from "../../tools/dismiss";
import { setStatusTool } from "../../tools/set-status";
import { savePrefsTool, setPrefTool } from "../../tools/triage-prefs";

const SCOPE = { user_id: "user-1", organization_id: "org-1" };
const NOW = new Date("2026-05-18T12:00:00.000Z");

let root: string;
let ctx: ViewToolContext;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mutations-test-"));
  ctx = createLocalFsContext({
    root,
    scope: SCOPE,
    now: () => NOW,
  });
  // The action files live at <root>/actions/. The directory is created
  // implicitly by writeFile, but seeding helpers here keep tests terse.
  mkdirSync(join(root, "actions"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

function seedAction(id: string, body: string): Promise<void> {
  return writeFile(join(root, "actions", `${id}.md`), body, "utf8");
}

async function readAction(id: string): Promise<string> {
  return readFile(join(root, "actions", `${id}.md`), "utf8");
}

describe("snooze tool", () => {
  it("sets status=snoozed and snoozed_until; clears completion fields", async () => {
    await seedAction(
      "a",
      "---\nstatus: open\ncompleted_at: null\n---\nbody\n",
    );
    await snoozeTool.handle(
      { id: "a", until: "2026-06-01" },
      ctx,
    );
    const file = await readAction("a");
    expect(file).toContain("status: snoozed");
    expect(file).toContain("snoozed_until: 2026-06-01");
    expect(file).toContain("completed_at: null");
    expect(file).toContain("dismissed_at: null");
  });

  it("rejects path traversal in id", async () => {
    await expect(
      snoozeTool.handle({ id: "../../etc", until: "2026-06-01" }, ctx),
    ).rejects.toThrow(/path traversal|invalid action id/i);
  });
});

describe("dismiss tool", () => {
  it("sets status=dismissed and dismissed_at", async () => {
    await seedAction("a", "---\nstatus: open\n---\nbody\n");
    await dismissTool.handle({ id: "a" }, ctx);
    const file = await readAction("a");
    expect(file).toContain("status: dismissed");
    expect(file).toContain(`dismissed_at: ${NOW.toISOString()}`);
  });

  it("appends `## Outcome` block when outcome is supplied", async () => {
    await seedAction("a", "---\nstatus: open\n---\noriginal body\n");
    await dismissTool.handle(
      { id: "a", outcome: "noise", outcome_note: "spam" },
      ctx,
    );
    const file = await readAction("a");
    expect(file).toContain("## Outcome");
    expect(file).toContain("noise");
    expect(file).toContain("spam");
  });

  it("does NOT append `## Outcome` when outcome is empty", async () => {
    await seedAction("a", "---\nstatus: open\n---\nbody\n");
    await dismissTool.handle({ id: "a" }, ctx);
    const file = await readAction("a");
    expect(file).not.toContain("## Outcome");
  });
});

describe("set-status tool", () => {
  it("status=done sets completed_at and clears snoozed_until/dismissed_at", async () => {
    await seedAction(
      "a",
      "---\nstatus: snoozed\nsnoozed_until: 2026-07-01\n---\nbody\n",
    );
    await setStatusTool.handle({ id: "a", status: "done" }, ctx);
    const file = await readAction("a");
    expect(file).toContain("status: done");
    expect(file).toContain(`completed_at: ${NOW.toISOString()}`);
    expect(file).toContain("snoozed_until: null");
  });

  it("team-scoped status=done writes done_by_user_slug/_id/_at", async () => {
    mkdirSync(join(root, "teams/platform/actions"), { recursive: true });
    await writeFile(
      join(root, "teams/platform/actions/a.md"),
      "---\nstatus: open\n---\n",
      "utf8",
    );
    await setStatusTool.handle(
      {
        id: "a",
        status: "done",
        team_slug: "platform",
        user_slug: "alice",
        user_id: "u-alice",
      },
      ctx,
    );
    const file = await readFile(
      join(root, "teams/platform/actions/a.md"),
      "utf8",
    );
    expect(file).toContain("done_by_user_slug: alice");
    expect(file).toContain("done_by_user_id: u-alice");
    expect(file).toContain(`done_at: ${NOW.toISOString()}`);
  });

  it("status=open clears every timestamp + team audit fields", async () => {
    await seedAction(
      "a",
      "---\nstatus: done\ncompleted_at: 2026-05-01T00:00:00Z\n---\n",
    );
    await setStatusTool.handle({ id: "a", status: "open" }, ctx);
    const file = await readAction("a");
    expect(file).toContain("status: open");
    expect(file).toContain("completed_at: null");
    expect(file).toContain("snoozed_until: null");
    expect(file).toContain("dismissed_at: null");
  });

  it("rejects unknown status values", async () => {
    await seedAction("a", "---\nstatus: open\n---\n");
    await expect(
      setStatusTool.handle({ id: "a", status: "frobnicate" }, ctx),
    ).rejects.toThrow(/Invalid status/);
  });
});

describe("save_triage_prefs tool", () => {
  it("creates the prefs file when absent, with v2 defaults applied", async () => {
    await savePrefsTool.handle({ sort: "due" }, ctx);
    const body = await readFile(
      join(root, ".agntux/triage-prefs.json"),
      "utf8",
    );
    const parsed = JSON.parse(body);
    expect(parsed.schema_version).toBe(2);
    expect(parsed.sort).toBe("due");
  });

  it("merges legacy muted_team_slugs into team_filters", async () => {
    await savePrefsTool.handle(
      { muted_team_slugs: ["platform", "infra"] },
      ctx,
    );
    const body = await readFile(
      join(root, ".agntux/triage-prefs.json"),
      "utf8",
    );
    const parsed = JSON.parse(body);
    expect(parsed.team_filters).toEqual({
      platform: "hidden",
      infra: "hidden",
    });
    // Legacy array kept in sync for older bundles.
    expect(parsed.muted_team_slugs).toEqual(["platform", "infra"]);
  });

  it("patches a single key without touching others", async () => {
    await savePrefsTool.handle({ sort: "priority" }, ctx);
    await savePrefsTool.handle({ show_done: true }, ctx);
    const body = await readFile(
      join(root, ".agntux/triage-prefs.json"),
      "utf8",
    );
    const parsed = JSON.parse(body);
    expect(parsed.sort).toBe("priority"); // preserved across the second call
    expect(parsed.show_done).toBe(true);
  });

  it("ignores invalid sort keys", async () => {
    await savePrefsTool.handle({ sort: "garbage" }, ctx);
    const body = await readFile(
      join(root, ".agntux/triage-prefs.json"),
      "utf8",
    );
    expect(JSON.parse(body).sort).toBe("priority"); // default
  });
});

describe("set_triage_pref tool", () => {
  it("sets snoozed_until for a specific path", async () => {
    await setPrefTool.handle(
      {
        path: "actions/foo.md",
        snoozed_until: "2026-06-01T00:00:00Z",
      },
      ctx,
    );
    const body = await readFile(
      join(root, ".agntux/triage-prefs.json"),
      "utf8",
    );
    const parsed = JSON.parse(body);
    expect(parsed.triage_state["actions/foo.md"]).toEqual({
      snoozed_until: "2026-06-01T00:00:00Z",
      dismissed_at: null,
    });
  });

  it("removes the entry entirely when both fields are null", async () => {
    await setPrefTool.handle(
      { path: "actions/foo.md", snoozed_until: "2026-06-01T00:00:00Z" },
      ctx,
    );
    await setPrefTool.handle(
      { path: "actions/foo.md", snoozed_until: null, dismissed_at: null },
      ctx,
    );
    const body = await readFile(
      join(root, ".agntux/triage-prefs.json"),
      "utf8",
    );
    expect(JSON.parse(body).triage_state).toEqual({});
  });

  it("rejects path traversal in triage_state keys", async () => {
    await expect(
      setPrefTool.handle(
        {
          path: "actions/../../etc/passwd.md",
          dismissed_at: "2026-05-01T00:00:00Z",
        },
        ctx,
      ),
    ).rejects.toThrow(/path traversal/i);
  });

  it("rejects paths outside the allowed pattern set", async () => {
    await expect(
      setPrefTool.handle(
        { path: "random.txt", dismissed_at: "2026-05-01T00:00:00Z" },
        ctx,
      ),
    ).rejects.toThrow(/path traversal|invalid triage-prefs path/i);
  });
});
