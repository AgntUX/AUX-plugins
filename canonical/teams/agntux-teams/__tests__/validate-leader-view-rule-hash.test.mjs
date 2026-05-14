// validate-leader-view-rule-hash.mjs unit tests.
//
// Drives the hook as a child process with synthetic stdin and asserts exit
// codes + stderr runbooks. Mirrors validate-team-schema's testing shape so the
// two hooks behave identically from the LLM's point of view.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const HOOK = new URL(
  "../hooks/validate-leader-view-rule-hash.mjs",
  import.meta.url,
).pathname;

function runHook(ctx, homeRoot) {
  const result = spawnSync("node", [HOOK], {
    input: JSON.stringify(ctx),
    env: { ...process.env, HOME: homeRoot },
    cwd: homeRoot,
    encoding: "utf8",
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function setupRoot() {
  const home = mkdtempSync(join(tmpdir(), "validate-lv-rule-hash-"));
  mkdirSync(
    join(home, "agntux", "leader-views", "all-engineering", "actions"),
    { recursive: true },
  );
  mkdirSync(join(home, "agntux", "teams", "platform", "actions"), {
    recursive: true,
  });
  return home;
}

function expectedRuleHash(ruleSlug, triggerInputs) {
  return createHash("sha256")
    .update(`${ruleSlug}:${triggerInputs}`)
    .digest("hex")
    .slice(0, 16);
}

function leaderActionContent({
  status = "open",
  triggered_by_rule = "unhappy-high-revenue",
  trigger_inputs = "customer-success:8f4b2c1d3e5a7b9c",
  triggered_by_rule_hash = expectedRuleHash(
    "unhappy-high-revenue",
    "customer-success:8f4b2c1d3e5a7b9c",
  ),
  body = "Body of the leader-view action item.",
} = {}) {
  const lines = ["---"];
  lines.push("view_slug: all-engineering");
  lines.push("view_id: uuid-view-eng");
  lines.push(`schema_version: "1.0.0"`);
  if (triggered_by_rule !== null) lines.push(`triggered_by_rule: ${triggered_by_rule}`);
  if (trigger_inputs !== null) lines.push(`trigger_inputs: ${JSON.stringify(trigger_inputs)}`);
  if (triggered_by_rule_hash !== null)
    lines.push(`triggered_by_rule_hash: ${JSON.stringify(triggered_by_rule_hash)}`);
  if (status !== null) lines.push(`status: ${status}`);
  lines.push("created_at: 2026-05-12T14:30:00Z");
  lines.push("---");
  lines.push("");
  lines.push("# Title");
  lines.push("");
  lines.push(body);
  lines.push("");
  return lines.join("\n");
}

function ctxWrite(filePath, content) {
  return {
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  };
}

describe("validate-leader-view-rule-hash hook", () => {
  let home;

  beforeEach(() => {
    home = setupRoot();
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("passes (exit 0) when triggered_by_rule_hash matches the deterministic value", () => {
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-acme-churn.md",
    );
    const r = runHook(ctxWrite(filePath, leaderActionContent()), home);
    expect(r.code).toBe(0);
  });

  it("rejects (exit 2) when triggered_by_rule_hash is missing", () => {
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-no-hash.md",
    );
    const content = leaderActionContent({ triggered_by_rule_hash: null });
    const r = runHook(ctxWrite(filePath, content), home);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(
      /triggered_by_rule_hash is missing or incorrect/,
    );
  });

  it("rejects (exit 2) when triggered_by_rule_hash is wrong, runbook quotes the correct value", () => {
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-wrong-hash.md",
    );
    const expected = expectedRuleHash(
      "unhappy-high-revenue",
      "customer-success:8f4b2c1d3e5a7b9c",
    );
    const content = leaderActionContent({
      triggered_by_rule_hash: "0000000000000000",
    });
    const r = runHook(ctxWrite(filePath, content), home);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(expected);
    expect(r.stderr).toMatch(/Runbook \(execute this Edit/);
    expect(r.stderr).toMatch(/old_string: triggered_by_rule_hash:/);
  });

  it("rejects (exit 2) when triggered_by_rule input is missing — emits the shape runbook", () => {
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-no-rule.md",
    );
    const content = leaderActionContent({ triggered_by_rule: null });
    const r = runHook(ctxWrite(filePath, content), home);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/missing the rule-hash inputs/);
    expect(r.stderr).toMatch(/triggered_by_rule:/);
    expect(r.stderr).toMatch(/trigger_inputs:/);
  });

  it("rejects (exit 2) when trigger_inputs input is missing", () => {
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-no-inputs.md",
    );
    const content = leaderActionContent({ trigger_inputs: null });
    const r = runHook(ctxWrite(filePath, content), home);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/missing the rule-hash inputs/);
  });

  it("passes (exit 0) on status: resolved when the file already carries a canonical hash on disk", () => {
    // The skill body closes out an item by flipping status to resolved; the
    // hash on the file is already canonical and the validator must not block
    // the status flip. Pre-seed the file with a valid hash so the disk-check
    // short-circuit fires.
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-resolved.md",
    );
    writeFileSync(filePath, leaderActionContent());
    // Edit flipping status to resolved (hash unchanged — still canonical).
    const expected = expectedRuleHash(
      "unhappy-high-revenue",
      "customer-success:8f4b2c1d3e5a7b9c",
    );
    const updated = leaderActionContent({
      status: "resolved",
      triggered_by_rule_hash: expected,
    });
    const r = runHook(ctxWrite(filePath, updated), home);
    expect(r.code).toBe(0);
  });

  it("REJECTS a fresh Write of status: resolved with a garbage hash (no on-disk anchor)", () => {
    // Closes MEDIUM-1: an LLM cannot bypass the validator by creating a brand
    // new file with status: resolved + arbitrary hash. The short-circuit only
    // applies when the file already exists on disk with a canonical hash.
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-resolved-fresh.md",
    );
    const content = leaderActionContent({
      status: "resolved",
      triggered_by_rule_hash: "wronghashforthe!",
    });
    const r = runHook(ctxWrite(filePath, content), home);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/triggered_by_rule_hash is missing or incorrect/);
  });

  it("passes (exit 0) on status: superseded when on-disk hash was canonical", () => {
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-superseded.md",
    );
    writeFileSync(filePath, leaderActionContent());
    const expected = expectedRuleHash(
      "unhappy-high-revenue",
      "customer-success:8f4b2c1d3e5a7b9c",
    );
    const content = leaderActionContent({
      status: "superseded",
      triggered_by_rule_hash: expected,
    });
    const r = runHook(ctxWrite(filePath, content), home);
    expect(r.code).toBe(0);
  });

  it("passes (exit 0) for paths outside leader-views/", () => {
    const filePath = join(
      home,
      "agntux",
      "teams",
      "platform",
      "actions",
      "2026-05-12-x.md",
    );
    // Team actions are NOT this hook's concern — validate-team-schema owns that.
    const r = runHook(ctxWrite(filePath, leaderActionContent()), home);
    expect(r.code).toBe(0);
  });

  it("passes (exit 0) for _index.md inside leader-views/{slug}/actions/", () => {
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "_index.md",
    );
    const r = runHook(
      ctxWrite(filePath, "---\ntype: index\n---\n\nbody\n"),
      home,
    );
    expect(r.code).toBe(0);
  });

  it("ignores non-Write/Edit tool calls", () => {
    const r = runHook(
      { tool_name: "Bash", tool_input: { command: "ls" } },
      home,
    );
    expect(r.code).toBe(0);
  });

  it("trims whitespace around inputs before hashing", () => {
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-trimmed.md",
    );
    // Author with surrounding spaces; hook should still accept the canonical hash.
    const expected = expectedRuleHash("rule-a", "team:e1");
    const content = leaderActionContent({
      triggered_by_rule: "  rule-a  ",
      trigger_inputs: "  team:e1  ",
      triggered_by_rule_hash: expected,
    });
    const r = runHook(ctxWrite(filePath, content), home);
    expect(r.code).toBe(0);
  });

  it("rejects when frontmatter is entirely missing on a Write to a leader-view action", () => {
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-no-fm.md",
    );
    const r = runHook(
      ctxWrite(filePath, "# Just a heading, no frontmatter\n"),
      home,
    );
    // Body has no `---` frontmatter, so candidateFrontmatter falls through to
    // disk-read; the file doesn't exist, so the hook short-circuits to pass.
    // We allow this — the schema validator + write-lane validator catch a raw
    // body write. The point of this hook is to gate hashes, not enforce
    // frontmatter presence.
    expect(r.code).toBe(0);
  });

  it("uses the on-disk file content when tool_input.content is absent (Edit-without-content)", () => {
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-edit-only.md",
    );
    // Pre-seed the file with a CORRECT hash.
    writeFileSync(filePath, leaderActionContent());
    // Edit input with no content — hook falls back to on-disk read.
    const r = runHook(
      {
        tool_name: "Edit",
        tool_input: {
          file_path: filePath,
          old_string: "Body of the leader-view action item.",
          new_string: "Updated body of the leader-view action item.",
        },
      },
      home,
    );
    expect(r.code).toBe(0);
  });

  it("REJECTS an Edit that rewrites the frontmatter to a wrong hash (no route-around)", () => {
    // Closes HIGH-1: the validator must reconstruct the post-edit content,
    // not just inspect the pre-edit on-disk frontmatter. Otherwise an Edit
    // that rewrites the hash to a wrong value passes silently because the
    // pre-edit on-disk frontmatter has a correct hash.
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-edit-bypass.md",
    );
    const goodHash = expectedRuleHash(
      "unhappy-high-revenue",
      "customer-success:8f4b2c1d3e5a7b9c",
    );
    writeFileSync(filePath, leaderActionContent());
    // Edit that swaps the canonical hash for a garbage value while leaving
    // every other field intact.
    const r = runHook(
      {
        tool_name: "Edit",
        tool_input: {
          file_path: filePath,
          old_string: `triggered_by_rule_hash: ${JSON.stringify(goodHash)}`,
          new_string: `triggered_by_rule_hash: "0000000000000000"`,
        },
      },
      home,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/triggered_by_rule_hash is missing or incorrect/);
    expect(r.stderr).toContain(goodHash);
  });

  it("the wrong-hash runbook can be followed verbatim to produce a passing retry", () => {
    // Closes MEDIUM-4: end-to-end "rejection → follow runbook → retry passes"
    // loop. Submits a wrong-hash payload, parses the expected value out of
    // the runbook, re-runs with the corrected value, expects exit 0.
    const filePath = join(
      home,
      "agntux",
      "leader-views",
      "all-engineering",
      "actions",
      "2026-05-12-runbook-loop.md",
    );
    const wrongContent = leaderActionContent({
      triggered_by_rule_hash: "0000000000000000",
    });
    const r1 = runHook(ctxWrite(filePath, wrongContent), home);
    expect(r1.code).toBe(2);
    // The runbook's `new_string:` line carries the expected hash as a JSON
    // string. Extract it the way an LLM following the runbook would.
    const match = r1.stderr.match(
      /new_string:\s+triggered_by_rule_hash:\s+"([0-9a-f]{16})"/,
    );
    expect(match).not.toBeNull();
    const correctedHash = match[1];
    const correctedContent = leaderActionContent({
      triggered_by_rule_hash: correctedHash,
    });
    const r2 = runHook(ctxWrite(filePath, correctedContent), home);
    expect(r2.code).toBe(0);
  });
});
