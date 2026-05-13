// validate-write-lane.mjs unit tests.
// Drives the hook as a child process with synthetic stdin, asserts exit
// codes. Same idiom as validate-schema.test.mjs.
//
// The hook resolves <agntux project root> by walking up from cwd for an
// ancestor named "agntux" or falling back to ~/agntux. We override HOME
// in the spawned env so the project root is sandboxed to a temp dir.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = new URL("../hooks/validate-write-lane.mjs", import.meta.url).pathname;

function runHook(ctx, homeRoot) {
  const result = spawnSync("node", [HOOK], {
    input: JSON.stringify(ctx),
    env: { ...process.env, HOME: homeRoot },
    encoding: "utf8",
    cwd: homeRoot,
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function setupAgntuxRoot() {
  const home = mkdtempSync(join(tmpdir(), "validate-write-lane-"));
  mkdirSync(join(home, "agntux", "entities", "person"), { recursive: true });
  mkdirSync(join(home, "agntux", "actions"), { recursive: true });
  mkdirSync(join(home, "agntux", "data", "learnings", "agntux-slack"), {
    recursive: true,
  });
  mkdirSync(join(home, "agntux", "data", "schema", "contracts"), {
    recursive: true,
  });
  mkdirSync(join(home, "agntux", "data", "instructions"), { recursive: true });
  return home;
}

function writeFreshLock(home, slug, holder = "agntux-slack@7.0.0") {
  const dir = join(home, "agntux", "data", "learnings", slug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "sync.md");
  writeFileSync(
    path,
    [
      "---",
      `slug: ${slug}`,
      "updated_at: 2026-05-08T12:00:00Z",
      "---",
      "",
      "- cursor: {}",
      "- discovery_ts: null",
      "- last_run: null",
      "- last_success: null",
      "- items_processed: 0",
      "- errors: (none)",
      `- lock: held by ${holder} since ${new Date().toISOString()} (pid 12345)`,
      "",
    ].join("\n"),
  );
}

function writeStaleLock(home, slug, holder = "agntux-slack@7.0.0") {
  const dir = join(home, "agntux", "data", "learnings", slug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "sync.md");
  // 2 hours ago — past the 1-hour stale threshold.
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  writeFileSync(
    path,
    [
      "---",
      `slug: ${slug}`,
      "updated_at: 2026-05-08T10:00:00Z",
      "---",
      "",
      "- cursor: {}",
      "- discovery_ts: null",
      "- last_run: null",
      "- last_success: null",
      "- items_processed: 0",
      "- errors: (none)",
      `- lock: held by ${holder} since ${since} (pid 12345)`,
      "",
    ].join("\n"),
  );
}

function ctxWrite(filePath) {
  return {
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "irrelevant" },
  };
}

function ctxEdit(filePath) {
  return {
    tool_name: "Edit",
    tool_input: {
      file_path: filePath,
      old_string: "x",
      new_string: "y",
    },
  };
}

let home;

beforeEach(() => {
  home = setupAgntuxRoot();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("validate-write-lane.mjs — pass-through cases", () => {
  it("passes through when no ingest plugin is active (no sync.md exists)", () => {
    const r = runHook(
      ctxWrite(join(home, "agntux", "data", "schema", "schema.md")),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("passes through when the lock is stale (>1 hour)", () => {
    writeStaleLock(home, "agntux-slack");
    const r = runHook(
      ctxWrite(join(home, "agntux", "data", "schema", "schema.md")),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("passes through for non-Write/Edit tools", () => {
    writeFreshLock(home, "agntux-slack");
    const r = runHook(
      {
        tool_name: "Read",
        tool_input: { file_path: join(home, "agntux", "data", "schema", "schema.md") },
      },
      home,
    );
    expect(r.code).toBe(0);
  });

  it("passes through when stdin is malformed (no JSON)", () => {
    // The hook returns null on JSON parse failure and pass()es.
    const result = spawnSync("node", [HOOK], {
      input: "not-json",
      env: { ...process.env, HOME: home },
      encoding: "utf8",
      cwd: home,
    });
    expect(result.status).toBe(0);
  });
});

describe("validate-write-lane.mjs — refuse off-lane during active ingest", () => {
  beforeEach(() => writeFreshLock(home, "agntux-slack"));

  it("refuses Write to data/schema/", () => {
    const r = runHook(
      ctxWrite(join(home, "agntux", "data", "schema", "schema.md")),
      home,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("write-lane-validator");
    expect(r.stderr).toContain("agntux-slack");
    expect(r.stderr).toContain("out-of-lane-write-attempted");
  });

  it("refuses Edit to data/schema/schema.lock.json", () => {
    const r = runHook(
      ctxEdit(join(home, "agntux", "data", "schema", "schema.lock.json")),
      home,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("data/schema/");
  });

  it("refuses Write to data/instructions/", () => {
    const r = runHook(
      ctxWrite(join(home, "agntux", "data", "instructions", "agntux-gmail.md")),
      home,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("data/instructions/");
  });

  it("refuses Write to entities/_sources.json", () => {
    const r = runHook(
      ctxWrite(join(home, "agntux", "entities", "_sources.json")),
      home,
    );
    expect(r.code).toBe(2);
  });

  it("refuses Write to actions/_index.md", () => {
    const r = runHook(
      ctxWrite(join(home, "agntux", "actions", "_index.md")),
      home,
    );
    expect(r.code).toBe(2);
  });

  it("refuses Write to entities/{subtype}/_index.md", () => {
    const r = runHook(
      ctxWrite(join(home, "agntux", "entities", "person", "_index.md")),
      home,
    );
    expect(r.code).toBe(2);
  });

  it("refuses Write outside the project root", () => {
    const r = runHook(
      ctxWrite(join(home, "outside.md")),
      home,
    );
    expect(r.code).toBe(2);
  });
});

// P7 §"Per-folder write-ownership matrix" — only agntux-teams may write
// under <root>/teams/{slug}/{entities,actions}/ and <root>/leader-views/{slug}/actions/.
// Source plugins remain team-unaware; their writes to those subtrees reject.
describe("validate-write-lane.mjs — team lanes (P7)", () => {
  it("permits agntux-teams write to teams/{slug}/entities/{subtype}/{slug}.md", () => {
    writeFreshLock(home, "agntux-teams");
    mkdirSync(join(home, "agntux", "teams", "platform", "entities", "people"), {
      recursive: true,
    });
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "platform", "entities", "people", "alice.md"),
      ),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("permits agntux-teams write to teams/{slug}/actions/{date}-{slug}.md", () => {
    writeFreshLock(home, "agntux-teams");
    mkdirSync(join(home, "agntux", "teams", "platform", "actions"), { recursive: true });
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "platform", "actions", "2026-05-12-x.md"),
      ),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("permits agntux-teams write to leader-views/{slug}/actions/{date}-{slug}.md", () => {
    writeFreshLock(home, "agntux-teams");
    mkdirSync(join(home, "agntux", "leader-views", "all-eng", "actions"), {
      recursive: true,
    });
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "leader-views", "all-eng", "actions", "2026-05-12-x.md"),
      ),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("refuses source-plugin write to teams/{slug}/entities/ — team lanes are agntux-teams territory", () => {
    writeFreshLock(home, "agntux-slack");
    mkdirSync(join(home, "agntux", "teams", "platform", "entities", "people"), {
      recursive: true,
    });
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "platform", "entities", "people", "alice.md"),
      ),
      home,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("teams");
    expect(r.stderr).toMatch(/agntux-slack|agntux-teams/);
  });

  it("refuses source-plugin write to leader-views/", () => {
    writeFreshLock(home, "agntux-slack");
    mkdirSync(join(home, "agntux", "leader-views", "all-eng", "actions"), {
      recursive: true,
    });
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "leader-views", "all-eng", "actions", "2026-05-12-x.md"),
      ),
      home,
    );
    expect(r.code).toBe(2);
  });

  it("refuses agntux-teams write to leader-views/{slug}/entities/ — leader-views have no entities subtree (P7)", () => {
    // P7 §"Note on leader-views" — leader-views are an actions-only
    // substrate. A write to <root>/leader-views/{slug}/entities/* by ANY
    // plugin (including agntux-teams) must reject; only actions/*.md
    // belongs to the leader-view container.
    writeFreshLock(home, "agntux-teams");
    mkdirSync(join(home, "agntux", "leader-views", "all-eng", "entities", "people"), {
      recursive: true,
    });
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "leader-views", "all-eng", "entities", "people", "alice.md"),
      ),
      home,
    );
    expect(r.code).toBe(2);
  });

  it("refuses agntux-teams write to a malformed team-slug path", () => {
    // The slug regex rejects empty / uppercase / underscore-bearing slugs;
    // a malformed slug must fall through to the personal-only lane check
    // and reject as out-of-lane.
    writeFreshLock(home, "agntux-teams");
    mkdirSync(join(home, "agntux", "teams", "_Bad_Slug_", "entities", "people"), {
      recursive: true,
    });
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "_Bad_Slug_", "entities", "people", "alice.md"),
      ),
      home,
    );
    expect(r.code).toBe(2);
  });
});

describe("validate-write-lane.mjs — permit on-lane during active ingest", () => {
  beforeEach(() => writeFreshLock(home, "agntux-slack"));

  it("permits Write to entities/{subtype}/{slug}.md", () => {
    const r = runHook(
      ctxWrite(join(home, "agntux", "entities", "person", "alice.md")),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("permits Write to actions/{date}-{slug}.md", () => {
    const r = runHook(
      ctxWrite(join(home, "agntux", "actions", "2026-05-08-test.md")),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("permits Write to data/learnings/{slug}/sync.md (own slug)", () => {
    const r = runHook(
      ctxWrite(join(home, "agntux", "data", "learnings", "agntux-slack", "sync.md")),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("permits Write to data/learnings/{slug}/{helper}.md (helper artefact)", () => {
    // The hook permits any file under data/learnings/{slug}/, not just sync.md.
    // This matches the canonical Out-of-scope rule which names the directory
    // as the writable surface (canonical sync.md Step 2 sub-step 2).
    mkdirSync(join(home, "agntux", "data", "learnings", "agntux-slack"), {
      recursive: true,
    });
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "data", "learnings", "agntux-slack", "queue.md"),
      ),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("refuses Write to non-md file in entities/", () => {
    const r = runHook(
      ctxWrite(join(home, "agntux", "entities", "person", "alice.json")),
      home,
    );
    expect(r.code).toBe(2);
  });
});
