// validate-team-schema.mjs unit tests.
//
// Drives the hook as a child process with synthetic stdin (mirrors the
// shape of validate-team-write-lane.test.mjs) AND imports pure helpers
// for fast, in-process unit coverage of the path classifier.
//
// Verification matrix coverage (P9 §"Verification"):
//   - item 1: single-cycle write of valid trigger_key passes.
//   - item 14: hook rejects manual write with WRONG trigger_key; runbook
//     quotes the correct value.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { classifyTeamAction } from "../hooks/validate-team-schema.mjs";
import { _setAgntuxRootForTesting } from "../hooks/lib/agntux-root.mjs";

const HOOK = new URL("../hooks/validate-team-schema.mjs", import.meta.url)
  .pathname;

function expectedKey(teamSlug, reasonClass, entityIdOrSourceRef) {
  return createHash("sha256")
    .update(`${teamSlug}:${reasonClass}:${entityIdOrSourceRef}`)
    .digest("hex")
    .slice(0, 16);
}

function runHook(ctx, homeRoot) {
  const env = { ...process.env, HOME: homeRoot };
  const result = spawnSync("node", [HOOK], {
    input: JSON.stringify(ctx),
    env,
    encoding: "utf8",
    cwd: homeRoot,
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function setupRoot() {
  const home = mkdtempSync(join(tmpdir(), "validate-team-schema-"));
  mkdirSync(join(home, "agntux", "teams", "platform", "actions"), {
    recursive: true,
  });
  mkdirSync(join(home, "agntux", "teams", "platform", "entities"), {
    recursive: true,
  });
  mkdirSync(join(home, "agntux", "actions"), { recursive: true });
  mkdirSync(
    join(home, "agntux", "leader-views", "all-engineering", "actions"),
    { recursive: true },
  );
  return home;
}

function actionContent({
  teamSlug = "platform",
  reasonClass = "customer-pain",
  triggerKey,
  entityId = "8f4b2c1d3e5a7b9c",
  sourceRef,
  status = "open",
  includeEntityRefs = true,
} = {}) {
  const lines = ["---"];
  lines.push("team_id: uuid-platform");
  lines.push(`team_slug: ${teamSlug}`);
  lines.push(`source_team: ${teamSlug}`);
  lines.push(`schema_version: "1.0.0"`);
  if (triggerKey !== undefined) {
    lines.push(`trigger_key: ${JSON.stringify(triggerKey)}`);
  }
  lines.push("relevance_classes:");
  lines.push("  - product-decisions");
  lines.push(`reason_class: ${reasonClass}`);
  if (includeEntityRefs && entityId) {
    lines.push("entity_refs:");
    lines.push(`  - entity_id: ${entityId}`);
    lines.push("    role: subject");
  }
  if (sourceRef) {
    lines.push(`source_ref: ${JSON.stringify(sourceRef)}`);
  }
  lines.push(`status: ${status}`);
  lines.push("done_by_user_slug: null");
  lines.push("done_by_user_id: null");
  lines.push("done_at: null");
  lines.push("created_at: 2026-05-12T14:30:00Z");
  lines.push("authored_by_user_slug: alice");
  lines.push("last_authored_at: 2026-05-12T14:30:00Z");
  lines.push("---");
  lines.push("");
  lines.push("# Acme Corp signaled churn risk");
  lines.push("");
  lines.push("Body.");
  lines.push("");
  return lines.join("\n");
}

function ctxWrite(filePath, content) {
  return {
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  };
}

function ctxEdit(filePath, oldString, newString, replaceAll = false) {
  return {
    tool_name: "Edit",
    tool_input: {
      file_path: filePath,
      old_string: oldString,
      new_string: newString,
      replace_all: replaceAll,
    },
  };
}

// --- Unit: path classifier ---------------------------------------------------

describe("classifyTeamAction", () => {
  let root;
  beforeEach(() => {
    root = setupRoot();
    _setAgntuxRootForTesting(join(root, "agntux"));
  });
  afterEach(() => {
    _setAgntuxRootForTesting(null);
    rmSync(root, { recursive: true, force: true });
  });

  it("classifies a valid team-action path", () => {
    const r = classifyTeamAction(
      join(root, "agntux", "teams", "platform", "actions", "2026-05-12-x.md"),
    );
    expect(r).toEqual({ teamSlug: "platform" });
  });

  it("returns null for team-action _index.md", () => {
    expect(
      classifyTeamAction(
        join(root, "agntux", "teams", "platform", "actions", "_index.md"),
      ),
    ).toBeNull();
  });

  it("returns null for team entities (not actions)", () => {
    expect(
      classifyTeamAction(
        join(
          root,
          "agntux",
          "teams",
          "platform",
          "entities",
          "people",
          "alice.md",
        ),
      ),
    ).toBeNull();
  });

  it("returns null for personal action files", () => {
    expect(
      classifyTeamAction(join(root, "agntux", "actions", "x.md")),
    ).toBeNull();
  });

  it("returns null for leader-view action files (handled by a different validator)", () => {
    expect(
      classifyTeamAction(
        join(
          root,
          "agntux",
          "leader-views",
          "all-engineering",
          "actions",
          "x.md",
        ),
      ),
    ).toBeNull();
  });

  it("returns null for non-.md files", () => {
    expect(
      classifyTeamAction(
        join(root, "agntux", "teams", "platform", "actions", "notes.txt"),
      ),
    ).toBeNull();
  });

  it("returns null for nested files under actions/", () => {
    expect(
      classifyTeamAction(
        join(
          root,
          "agntux",
          "teams",
          "platform",
          "actions",
          "sub",
          "x.md",
        ),
      ),
    ).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(classifyTeamAction(undefined)).toBeNull();
    expect(classifyTeamAction(null)).toBeNull();
    expect(classifyTeamAction(42)).toBeNull();
  });
});

// --- End-to-end: hook as child process --------------------------------------

describe("validate-team-schema hook end-to-end", () => {
  let home;

  beforeEach(() => {
    home = setupRoot();
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("passes (exit 0) for non-Write/Edit tool calls", () => {
    const r = runHook({ tool_name: "Bash", tool_input: { command: "ls" } }, home);
    expect(r.code).toBe(0);
  });

  it("passes for paths outside teams/", () => {
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "actions", "x.md"),
        actionContent({
          triggerKey: expectedKey("platform", "customer-pain", "8f4b2c1d3e5a7b9c"),
        }),
      ),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("passes for team-entity paths (not actions)", () => {
    const r = runHook(
      ctxWrite(
        join(
          home,
          "agntux",
          "teams",
          "platform",
          "entities",
          "people",
          "alice.md",
        ),
        "---\nid: alice\n---\n",
      ),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("passes for leader-view actions (different validator owns those)", () => {
    const r = runHook(
      ctxWrite(
        join(
          home,
          "agntux",
          "leader-views",
          "all-engineering",
          "actions",
          "x.md",
        ),
        "---\nview_slug: all-engineering\n---\n",
      ),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("passes for the hook-owned _index.md", () => {
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "platform", "actions", "_index.md"),
        "---\ntype: index\n---\n",
      ),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("passes when trigger_key matches the expected value (P9 verification item 1)", () => {
    const tk = expectedKey("platform", "customer-pain", "8f4b2c1d3e5a7b9c");
    const r = runHook(
      ctxWrite(
        join(
          home,
          "agntux",
          "teams",
          "platform",
          "actions",
          "2026-05-12-acme.md",
        ),
        actionContent({ triggerKey: tk }),
      ),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("rejects when trigger_key is wrong, and the runbook quotes the correct value (P9 verification item 14)", () => {
    const correct = expectedKey(
      "platform",
      "customer-pain",
      "8f4b2c1d3e5a7b9c",
    );
    const r = runHook(
      ctxWrite(
        join(
          home,
          "agntux",
          "teams",
          "platform",
          "actions",
          "2026-05-12-acme.md",
        ),
        actionContent({ triggerKey: "WRONG_VALUE_XXXX" }),
      ),
      home,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(correct);
    expect(r.stderr).toContain("trigger_key");
    // Runbook should propose an Edit with the canonical value.
    expect(r.stderr).toContain(`new_string: trigger_key: ${JSON.stringify(correct)}`);
  });

  it("rejects when trigger_key is missing entirely, and runbook quotes the correct value", () => {
    const correct = expectedKey(
      "platform",
      "customer-pain",
      "8f4b2c1d3e5a7b9c",
    );
    const r = runHook(
      ctxWrite(
        join(
          home,
          "agntux",
          "teams",
          "platform",
          "actions",
          "2026-05-12-acme.md",
        ),
        // intentionally no trigger_key key
        actionContent({ triggerKey: undefined }),
      ),
      home,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(correct);
  });

  it("rejects when trigger_key is the empty placeholder used by the skill body", () => {
    const correct = expectedKey(
      "platform",
      "customer-pain",
      "8f4b2c1d3e5a7b9c",
    );
    const r = runHook(
      ctxWrite(
        join(
          home,
          "agntux",
          "teams",
          "platform",
          "actions",
          "2026-05-12-acme.md",
        ),
        actionContent({ triggerKey: "" }),
      ),
      home,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(correct);
  });

  it("falls back to source_ref when entity_refs is absent", () => {
    const tk = expectedKey("platform", "renewal-risk", "acme-thread-42");
    const r = runHook(
      ctxWrite(
        join(
          home,
          "agntux",
          "teams",
          "platform",
          "actions",
          "2026-05-12-acme.md",
        ),
        actionContent({
          reasonClass: "renewal-risk",
          triggerKey: tk,
          includeEntityRefs: false,
          entityId: null,
          sourceRef: "acme-thread-42",
        }),
      ),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("rejects with the shape runbook when team_slug is missing", () => {
    // Build content with no team_slug.
    const content = [
      "---",
      `schema_version: "1.0.0"`,
      "reason_class: customer-pain",
      "entity_refs:",
      "  - entity_id: 8f4b2c1d3e5a7b9c",
      "    role: subject",
      "status: open",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "platform", "actions", "bad.md"),
        content,
      ),
      home,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("team_slug");
    expect(r.stderr).toContain("MISSING");
  });

  it("rejects when reason_class is missing", () => {
    const content = [
      "---",
      "team_slug: platform",
      `schema_version: "1.0.0"`,
      "entity_refs:",
      "  - entity_id: 8f4b2c1d3e5a7b9c",
      "    role: subject",
      "status: open",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "platform", "actions", "bad.md"),
        content,
      ),
      home,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("reason_class");
  });

  it("rejects when frontmatter is unparseable", () => {
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "platform", "actions", "bad.md"),
        "no frontmatter at all, just body text",
      ),
      home,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/frontmatter/i);
  });

  it("Edit: passes when the post-edit content still has the correct trigger_key", () => {
    const tk = expectedKey("platform", "customer-pain", "8f4b2c1d3e5a7b9c");
    const filePath = join(
      home,
      "agntux",
      "teams",
      "platform",
      "actions",
      "2026-05-12-acme.md",
    );
    writeFileSync(filePath, actionContent({ triggerKey: tk }));
    const r = runHook(
      ctxEdit(filePath, "status: open", "status: done"),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("Edit: rejects when the edit corrupts the trigger_key, and runbook quotes the correct value", () => {
    const correct = expectedKey(
      "platform",
      "customer-pain",
      "8f4b2c1d3e5a7b9c",
    );
    const filePath = join(
      home,
      "agntux",
      "teams",
      "platform",
      "actions",
      "2026-05-12-acme.md",
    );
    writeFileSync(filePath, actionContent({ triggerKey: correct }));
    const r = runHook(
      ctxEdit(
        filePath,
        `trigger_key: ${JSON.stringify(correct)}`,
        `trigger_key: "WRONG_VALUE_XXXX"`,
      ),
      home,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(correct);
  });

  it("Edit: passes through when the edit can't be reconstructed (body-only line on missing file)", () => {
    // Edit with old/new_string that doesn't start with `---\n` and a path that
    // doesn't exist → readContent returns null → hook passes (defers to other
    // hooks / the eventual Write).
    const r = runHook(
      ctxEdit(
        join(home, "agntux", "teams", "platform", "actions", "absent.md"),
        "foo",
        "bar",
      ),
      home,
    );
    expect(r.code).toBe(0);
  });
});
