// End-to-end fixture for P3 verification 6 (leader-view content-rule pass).
//
// Seeds:
//   - 2 teams (`customer-success`, `infrastructure`) with one recent action each
//   - 1 leader view (`all-engineering`) subscribed to both teams, with a
//     view-config.md body carrying:
//       · 1 alerting rule  (`unhappy-high-revenue`)
//       · 1 standing question (`weekly-velocity`)
//
// Drives:
//   1. The `validate-leader-view-rule-hash` PreToolUse hook against synthetic
//      Write payloads that match what the leader-view skill body would author
//      (one rule-fire action + one standing-question action).
//   2. The `maintain-team-index` PostToolUse hook's `rebuildActionsIndex` over
//      the resulting actions/ directory.
//
// Asserts (matching the P3 verification 6 spec):
//   - The hook accepts both authored items with a correctly-computed
//     `triggered_by_rule_hash`.
//   - The resulting `actions/_index.md` carries BOTH items under
//     `triggered_by_rule_hash_index:` (so the triage UI's S6.2 view can render
//     them).
//   - Re-authoring the same rule-fire (same inputs) is accepted without
//     creating a second file — the validator passes and the index continues
//     to list a single row under the rule's hash.
//
// The actual LLM-authoring of body content is out of scope for this test —
// that's a prompt-eval concern. We assert the deterministic artifacts the
// hooks produce, which is the contract the rest of the system reads.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdtempSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { _setAgntuxRootForTesting } from "../hooks/lib/agntux-root.mjs";
import { rebuildActionsIndex } from "../hooks/maintain-team-index.mjs";

const VALIDATOR_HOOK = new URL(
  "../hooks/validate-leader-view-rule-hash.mjs",
  import.meta.url,
).pathname;

function expectedRuleHash(ruleSlug, triggerInputs) {
  return createHash("sha256")
    .update(`${ruleSlug}:${triggerInputs}`)
    .digest("hex")
    .slice(0, 16);
}

function setupFixture() {
  const home = mkdtempSync(join(tmpdir(), "leader-view-cycle-"));
  const agntuxRoot = join(home, "agntux");

  // Personal lanes (lift-pass inputs, just sketched so a future test can
  // exercise step 2; the leader-view pass itself reads team-scoped data).
  mkdirSync(join(agntuxRoot, "entities", "customers"), { recursive: true });
  mkdirSync(join(agntuxRoot, "actions"), { recursive: true });
  writeFileSync(
    join(agntuxRoot, "user.md"),
    "---\nuser_slug: carol\n---\n\n# User\n",
  );

  // Two subscribed teams, each with one open action.
  for (const team of ["customer-success", "infrastructure"]) {
    mkdirSync(join(agntuxRoot, "teams", team, "data"), { recursive: true });
    mkdirSync(join(agntuxRoot, "teams", team, "entities"), { recursive: true });
    mkdirSync(join(agntuxRoot, "teams", team, "actions"), { recursive: true });
    writeFileSync(
      join(agntuxRoot, "teams", team, "data", "team-config.md"),
      [
        "---",
        `team_slug: ${team}`,
        `display_name: ${team}`,
        "cadence: 60m",
        `schema_version: "1.0.0"`,
        "onboarding_complete: true",
        "authorized_plugins:",
        "  - agntux-teams",
        "---",
        "",
      ].join("\n"),
    );
  }
  writeFileSync(
    join(
      agntuxRoot,
      "teams",
      "customer-success",
      "actions",
      "2026-05-12-acme-renewal-risk.md",
    ),
    [
      "---",
      "team_slug: customer-success",
      "schema_version: \"1.0.0\"",
      "reason_class: customer-pain",
      "trigger_key: customersuccess1",
      "entity_refs:",
      "  - entity_id: 8f4b2c1d3e5a7b9c",
      "    role: subject",
      "status: open",
      "created_at: 2026-05-12T14:00:00Z",
      "---",
      "",
      "## Why this matters",
      "Acme Corp showing churn risk; annual_revenue=$250k, sentiment=unhappy.",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(
      agntuxRoot,
      "teams",
      "infrastructure",
      "actions",
      "2026-05-12-sprint-close.md",
    ),
    [
      "---",
      "team_slug: infrastructure",
      "schema_version: \"1.0.0\"",
      "reason_class: sprint-update",
      "trigger_key: infraclose0001ab",
      "source_ref: sprint-2026-W19",
      "status: done",
      "created_at: 2026-05-12T13:00:00Z",
      "---",
      "",
      "## Why this matters",
      "Sprint closed 22 items vs. 14 prior-4 avg.",
      "",
    ].join("\n"),
  );

  // Leader view subscribing to both teams with one rule + one standing question.
  const viewRoot = join(agntuxRoot, "leader-views", "all-engineering");
  mkdirSync(join(viewRoot, "data"), { recursive: true });
  mkdirSync(join(viewRoot, "actions"), { recursive: true });
  writeFileSync(
    join(viewRoot, "data", "view-config.md"),
    [
      "---",
      "view_slug: all-engineering",
      "view_id: uuid-view-eng",
      "display_name: All Engineering",
      "owner_user_slug: carol",
      "subscribed_teams:",
      "  - customer-success",
      "  - infrastructure",
      `schema_version: "1.0.0"`,
      "---",
      "",
      "# Alerting rules",
      "",
      "## Rule: unhappy-high-revenue",
      "Triggers on customer-success actions for high-revenue unhappy customers.",
      "",
      "# Standing questions",
      "",
      "## Question: weekly-velocity",
      "Weekly engineering-velocity summary.",
      "",
    ].join("\n"),
  );

  return { home, agntuxRoot, viewRoot };
}

function runValidator(ctx, homeRoot) {
  return spawnSync("node", [VALIDATOR_HOOK], {
    input: JSON.stringify(ctx),
    env: { ...process.env, HOME: homeRoot },
    cwd: homeRoot,
    encoding: "utf8",
  });
}

function buildLeaderActionContent({
  rule,
  triggerInputs,
  body,
  status = "open",
}) {
  const hash = expectedRuleHash(rule, triggerInputs);
  return [
    "---",
    "view_slug: all-engineering",
    "view_id: uuid-view-eng",
    `schema_version: "1.0.0"`,
    `triggered_by_rule: ${rule}`,
    `trigger_inputs: ${JSON.stringify(triggerInputs)}`,
    `triggered_by_rule_hash: ${JSON.stringify(hash)}`,
    "source_team_refs:",
    "  - team_slug: customer-success",
    "    refs:",
    "      - kind: action",
    "        path: actions/2026-05-12-acme-renewal-risk.md",
    `status: ${status}`,
    "created_at: 2026-05-12T15:00:00Z",
    "authored_by_user_slug: carol",
    "last_authored_at: 2026-05-12T15:00:00Z",
    "---",
    "",
    "# Title",
    "",
    body,
    "",
  ].join("\n");
}

describe("leader-view cycle (P3 verification 6) — end-to-end fixture", () => {
  let fixture;

  beforeEach(() => {
    fixture = setupFixture();
    _setAgntuxRootForTesting(fixture.agntuxRoot);
  });

  afterEach(() => {
    _setAgntuxRootForTesting(null);
    rmSync(fixture.home, { recursive: true, force: true });
  });

  it("produces one rule-fire action + one standing-question action, indexed by triggered_by_rule_hash", () => {
    // (A) Author the rule-fire action.
    const rulePath = join(
      fixture.viewRoot,
      "actions",
      "2026-05-12-acme-churn-risk.md",
    );
    const ruleContent = buildLeaderActionContent({
      rule: "unhappy-high-revenue",
      triggerInputs: "customer-success:8f4b2c1d3e5a7b9c",
      body: "Acme Corp is showing churn risk. Suggested: personal outreach.",
    });
    const v1 = runValidator(
      { tool_name: "Write", tool_input: { file_path: rulePath, content: ruleContent } },
      fixture.home,
    );
    expect(v1.status).toBe(0);
    writeFileSync(rulePath, ruleContent);

    // (B) Author the standing-question action.
    const questionPath = join(
      fixture.viewRoot,
      "actions",
      "2026-05-12-weekly-velocity.md",
    );
    const questionContent = buildLeaderActionContent({
      rule: "weekly-velocity",
      triggerInputs: "weekly:2026-W19",
      body: "Engineering shipped 22 items vs. 14 prior-4 avg.",
    });
    const v2 = runValidator(
      {
        tool_name: "Write",
        tool_input: { file_path: questionPath, content: questionContent },
      },
      fixture.home,
    );
    expect(v2.status).toBe(0);
    writeFileSync(questionPath, questionContent);

    // (C) Run the PostToolUse rebuild.
    rebuildActionsIndex(
      join(fixture.viewRoot, "actions"),
      "view",
      "all-engineering",
    );

    // (D) The index lists both items under triggered_by_rule_hash_index.
    const idxRaw = readFileSync(
      join(fixture.viewRoot, "actions", "_index.md"),
      "utf8",
    );
    expect(idxRaw).toMatch(/triggered_by_rule_hash_index:/);
    expect(idxRaw).not.toMatch(/trigger_key_index:/);
    const ruleHash = expectedRuleHash(
      "unhappy-high-revenue",
      "customer-success:8f4b2c1d3e5a7b9c",
    );
    const questionHash = expectedRuleHash("weekly-velocity", "weekly:2026-W19");
    expect(idxRaw).toContain(ruleHash);
    expect(idxRaw).toContain(questionHash);
    expect(idxRaw).toMatch(/2026-05-12-acme-churn-risk\.md/);
    expect(idxRaw).toMatch(/2026-05-12-weekly-velocity\.md/);
    expect(idxRaw).toMatch(/entry_count: 2/);
  });

  it("re-running the cycle keeps existing actions in place (no duplicates)", () => {
    // Seed the rule-fire action from the first cycle.
    const rulePath = join(
      fixture.viewRoot,
      "actions",
      "2026-05-12-acme-churn-risk.md",
    );
    const ruleContent = buildLeaderActionContent({
      rule: "unhappy-high-revenue",
      triggerInputs: "customer-success:8f4b2c1d3e5a7b9c",
      body: "Initial body.",
    });
    writeFileSync(rulePath, ruleContent);

    // Second cycle: re-author with updated body but identical inputs (the
    // skill body's "EXISTING + trigger active → re-author in place" branch).
    const reauthored = buildLeaderActionContent({
      rule: "unhappy-high-revenue",
      triggerInputs: "customer-success:8f4b2c1d3e5a7b9c",
      body: "Refreshed body with the latest data.",
    });
    const v = runValidator(
      {
        tool_name: "Write",
        tool_input: { file_path: rulePath, content: reauthored },
      },
      fixture.home,
    );
    expect(v.status).toBe(0);
    writeFileSync(rulePath, reauthored);

    // The actions/ directory still contains exactly one file under that hash.
    rebuildActionsIndex(
      join(fixture.viewRoot, "actions"),
      "view",
      "all-engineering",
    );
    const idxRaw = readFileSync(
      join(fixture.viewRoot, "actions", "_index.md"),
      "utf8",
    );
    expect(idxRaw).toMatch(/entry_count: 1/);
    // Body of the canonical file is the re-authored content.
    const fileRaw = readFileSync(rulePath, "utf8");
    expect(fileRaw).toContain("Refreshed body");
    expect(fileRaw).not.toContain("Initial body.");
  });

  it("marks resolved actions appropriately — they drop out of the active rule_hash index", () => {
    // Seed an open action.
    const rulePath = join(
      fixture.viewRoot,
      "actions",
      "2026-05-12-acme-churn-risk.md",
    );
    writeFileSync(
      rulePath,
      buildLeaderActionContent({
        rule: "unhappy-high-revenue",
        triggerInputs: "customer-success:8f4b2c1d3e5a7b9c",
        body: "Open body.",
      }),
    );

    // Flip to resolved via a fresh content payload — the validator's
    // status-resolved short-circuit accepts even if the hash on the resolved
    // payload were stale (it isn't here, but the contract guarantees it).
    const resolved = buildLeaderActionContent({
      rule: "unhappy-high-revenue",
      triggerInputs: "customer-success:8f4b2c1d3e5a7b9c",
      body: "Marked resolved by the leader.",
      status: "resolved",
    });
    const v = runValidator(
      { tool_name: "Write", tool_input: { file_path: rulePath, content: resolved } },
      fixture.home,
    );
    expect(v.status).toBe(0);
    writeFileSync(rulePath, resolved);

    rebuildActionsIndex(
      join(fixture.viewRoot, "actions"),
      "view",
      "all-engineering",
    );
    const idxRaw = readFileSync(
      join(fixture.viewRoot, "actions", "_index.md"),
      "utf8",
    );
    // entry_count still reflects the file existing (the index lists every
    // action regardless of status; the hash-index is the only thing that
    // omits closed rows).
    expect(idxRaw).toMatch(/entry_count: 1/);
    const hash = expectedRuleHash(
      "unhappy-high-revenue",
      "customer-success:8f4b2c1d3e5a7b9c",
    );
    // The rule_hash_index does NOT include the resolved row — that's the
    // skill body's signal that re-firing the rule won't double-author.
    const hashSection = idxRaw.split("triggered_by_rule_hash_index:")[1];
    if (hashSection) {
      // Either the map is empty {} or it has no entries pointing at the file.
      expect(hashSection).not.toMatch(/2026-05-12-acme-churn-risk\.md/);
    }
    // Sanity: the file is still on disk for audit purposes.
    expect(existsSync(rulePath)).toBe(true);
  });
});
