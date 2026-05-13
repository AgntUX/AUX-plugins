// onboard-team-lead.md skill-body content tests.
//
// The skill body is a prompt, not code. These static asserts pin the
// load-bearing structure so regressions show up in CI:
//
//  - 11 steps (0–10) with correct headings, in order.
//  - Lint pass 8: ≤ 500 lines (CLAUDE.md).
//  - The P8 step-3 inference heuristic mapping is present verbatim.
//  - The Step-6 cadence picker cron expressions match P8.
//  - The native Cowork tools called out in P8 are referenced
//    (AskUserQuestion, mcp__scheduled-tasks__create_scheduled_task,
//    mcp__cowork__create_artifact).
//  - The validate-team-write-lane hook contract is honoured (writes
//    attributed to agntux-teams; team-config.md authorized_plugins
//    list seeded with agntux-teams).
//
// We do NOT invoke the LLM at test time — these are prompt-grep
// assertions on the markdown source.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_BODY = join(
  HERE,
  "..",
  "skills",
  "agntux-teams",
  "reference",
  "onboard-team-lead.md",
);

const body = readFileSync(SKILL_BODY, "utf8");
const lines = body.split("\n");

describe("onboard-team-lead.md — file shape", () => {
  it("has a top-level heading matching the slash-command pattern", () => {
    expect(lines[0]).toBe(
      "# `/agntux-teams onboard:team-lead {team-slug}` — Team-Lead onboarding",
    );
  });

  it("stays at or under the CLAUDE.md lint pass 8 ceiling of 500 lines", () => {
    // Trailing-newline-only lines count toward `wc -l`. We strip the
    // final empty entry that `split("\n")` produces when the file
    // ends with a newline so the assertion matches `wc -l`.
    const wcLines = body.endsWith("\n") ? lines.length - 1 : lines.length;
    expect(wcLines).toBeLessThanOrEqual(500);
  });

  it("does NOT carry the S3.4 stub marker", () => {
    expect(body).not.toMatch(/STUB — S5\.1 fills in the interview content/);
    expect(body).not.toMatch(/TODO — Interview content/);
  });
});

describe("onboard-team-lead.md — 11 ordered steps (0–10)", () => {
  const expectedHeadings = [
    "## Step 0 — Preflight (no writes)",
    "## Step 1 — Team identity (anchor)",
    "## Step 2 — Team scope (3–4 adaptive follow-ups)",
    "## Step 3 — Pre-suggested relevance classes",
    "## Step 4 — Schema design",
    "## Step 5 — Per-plugin instructions (lazy, optional)",
    "## Step 6 — Cadence picker",
    "## Step 7 — Register the team-sync scheduled task",
    "## Step 8 — Team-lead's own member record",
    "## Step 9 — Schema-ready trigger + summary artifact",
    "## Step 10 — Drop the marker",
  ];

  it("contains each Step heading exactly once", () => {
    for (const heading of expectedHeadings) {
      const occurrences = body
        .split("\n")
        .filter((l) => l === heading).length;
      expect(occurrences, `heading ${heading}`).toBe(1);
    }
  });

  it("orders the Step headings 0 → 10", () => {
    const indices = expectedHeadings.map((h) => body.indexOf(h));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i], `${expectedHeadings[i]} must come after the prior`).toBeGreaterThan(
        indices[i - 1],
      );
    }
  });
});

describe("onboard-team-lead.md — Step 0 preflight contract", () => {
  it("verifies team-lead role from teams.json memberships", () => {
    expect(body).toMatch(/teams\.json\.memberships\[\]/);
    expect(body).toMatch(/team_role/);
  });

  it("delegates to /agntux onboard when user.md is missing", () => {
    expect(body).toMatch(/<root>\/user\.md/);
    expect(body).toMatch(/`\/agntux onboard`/);
  });

  it("flips to edit mode when schema.lock.json already exists", () => {
    expect(body).toMatch(/schema\.lock\.json/);
    expect(body).toMatch(/edit mode/);
  });

  it("resumes from the per-team onboarding.md marker", () => {
    expect(body).toMatch(/<root>\/teams\/\{team-slug\}\/data\/onboarding\.md/);
    expect(body).toMatch(/last_completed_step/);
  });

  it("safeguards against partial Step-4 crashes (marker past 4, no lock → re-run Step 4)", () => {
    // Without this guard, a half-written schema would silently pass
    // through to Step 5 and the team-config would never reach
    // schema-ready state. Pin the safeguard so refactors can't drop
    // it.
    expect(body).toMatch(
      /last_completed_step[^\n]{0,12}>=\s*4[\s\S]{0,200}schema\.lock\.json[^\n]{0,8}is\s+missing/,
    );
    expect(body).toMatch(/re-run\s+Step\s+4\s+from\s+scratch/);
  });

  it("seeds team-config.md with agntux-teams in authorized_plugins", () => {
    expect(body).toMatch(/authorized_plugins:\s*\n\s*-\s*agntux-teams/);
  });
});

describe("onboard-team-lead.md — Step 3 inference heuristic (P8 verbatim)", () => {
  it("carries the five scope-signal rows verbatim", () => {
    const rows = [
      /Customer-facing \(sales, CX, support\) \| `customer-pain`, `customer-escalation`, `product-feedback`, `account-status`/,
      /Product \/ engineering \| `product-decisions`, `customer-pain`, `infra-incidents`, `velocity-blockers`/,
      /Ops \/ infrastructure \| `infra-incidents`, `velocity-blockers`, `cost-anomalies`, `compliance-flags`/,
      /Leadership \/ cross-functional \| `velocity-blockers`, `customer-escalation`, `product-decisions`, `team-health-signals`/,
      /Catch-all default \| `customer-pain`, `product-decisions`, `velocity-blockers`, `general`/,
    ];
    for (const r of rows) expect(body).toMatch(r);
  });

  it("documents one-line descriptions for every slug used in the heuristic", () => {
    const slugs = [
      "customer-pain",
      "customer-escalation",
      "product-feedback",
      "account-status",
      "product-decisions",
      "infra-incidents",
      "velocity-blockers",
      "cost-anomalies",
      "compliance-flags",
      "team-health-signals",
      "general",
    ];
    for (const slug of slugs) {
      // Expect a row like:  | `slug` | description |
      const re = new RegExp(
        `\\|\\s*\`${slug}\`\\s*\\|\\s+\\S.*\\|`,
      );
      expect(body, `description row for ${slug}`).toMatch(re);
    }
  });

  it("caps the edit dialogue at 3 rounds inside Step 3", () => {
    // Anchor the "max 3 rounds" assertion to the Step-3 prose so a
    // future drift that moves the phrase elsewhere can't pass silently.
    const step3 = body.slice(
      body.indexOf("## Step 3 — Pre-suggested relevance classes"),
      body.indexOf("## Step 4 — Schema design"),
    );
    expect(step3).toMatch(/max 3 rounds/);
  });
});

describe("onboard-team-lead.md — Step 4 schema design", () => {
  it("calls out the plugin-agnostic invariant", () => {
    expect(body).toMatch(/plugin-agnostic/);
    expect(body).toMatch(
      /never\s+references\s+specific\s+source\s+plugin\s+slugs/,
    );
  });

  it("writes schema_version 1.0.0 in the lock", () => {
    expect(body).toMatch(/"schema_version":\s*"1\.0\.0"/);
  });

  it("requires the P9 team-action fields from day one", () => {
    const requiredFields = [
      "team_id",
      "team_slug",
      "source_team",
      "trigger_key",
      "relevance_classes",
      "reason_class",
      "entity_refs",
      "status",
      "created_at",
      "authored_by_user_slug",
      "last_authored_at",
    ];
    for (const f of requiredFields) {
      expect(body, `required_action_fields includes ${f}`).toMatch(
        new RegExp(`\\b${f}\\b`),
      );
    }
  });

  it("notes that the validator hook fills checksum and the LLM never hashes", () => {
    expect(body).toMatch(/sha256:UNCOMPUTED/);
    expect(body).toMatch(/LLM\s+never\s+hashes|never\s+compute\s+hashes/);
  });

  it("flags the closure fields as nullable and excluded from required_action_fields", () => {
    // The Step 4 prose enumerates `done_by_user_slug`, `done_by_user_id`,
    // `done_at` but qualifies them as nullable closure fields, so the
    // lock's `required_action_fields[]` correctly omits them. Pinning
    // this prevents a future "make-required" drift that would break
    // every freshly-authored team action.
    expect(body).toMatch(/done_by_user_slug/);
    expect(body).toMatch(/done_at/);
    expect(body).toMatch(/Closure\s+fields/);
    expect(body).toMatch(/nullable[\s\S]{0,80}required_action_fields/);

    // Hard guard: the lock JSON sample does NOT list closure fields.
    const lockStart = body.indexOf('"required_action_fields"');
    const lockEnd = body.indexOf("]", lockStart);
    const lockBlock = body.slice(lockStart, lockEnd);
    expect(lockBlock).not.toMatch(/done_by_user_slug/);
    expect(lockBlock).not.toMatch(/done_at/);
  });
});

describe("onboard-team-lead.md — Step 5 per-plugin instructions", () => {
  it("declares per-plugin instructions are read-only consultation, not write grants", () => {
    // Guards against a reader assuming "naming Slack here authorizes
    // agntux-slack to write into the team root". The validate-team-
    // write-lane hook only authorizes `agntux-teams`.
    expect(body).toMatch(/read-only\s+consultation/);
    expect(body).toMatch(/does\s+NOT\s+add\s+it\s+to\s+`authorized_plugins/);
  });
});

describe("onboard-team-lead.md — Step 6 cadence cron mappings", () => {
  it("maps every-hour to the documented cron", () => {
    expect(body).toMatch(/Every hour \(recommended\) \| `0 7-21 \* \* \*`/);
  });

  it("maps every-30-minutes to the documented cron", () => {
    expect(body).toMatch(/Every 30 minutes \| `\*\/30 7-21 \* \* \*`/);
  });

  it("maps every-4-hours to the documented cron", () => {
    expect(body).toMatch(/Every 4 hours \| `0 7,11,15,19 \* \* \*`/);
  });
});

describe("onboard-team-lead.md — native Cowork tool usage", () => {
  it("calls AskUserQuestion at the multi-select picks (Step 3) and cadence picker (Step 6)", () => {
    const occurrences = (body.match(/AskUserQuestion/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("uses mcp__scheduled-tasks__create_scheduled_task with the expected taskId pattern", () => {
    expect(body).toMatch(/mcp__scheduled-tasks__create_scheduled_task/);
    expect(body).toMatch(/agntux-teams-sync-\{team-slug\}/);
  });

  it("uses mcp__scheduled-tasks__update_scheduled_task in edit mode", () => {
    expect(body).toMatch(/mcp__scheduled-tasks__update_scheduled_task/);
  });

  it("renders the summary card via mcp__cowork__create_artifact with a stable id", () => {
    expect(body).toMatch(/mcp__cowork__create_artifact/);
    expect(body).toMatch(/agntux-teams-onboard-\{team-slug\}/);
  });

  it("falls back gracefully when native tools are unavailable", () => {
    // Step 7 fallback + Step 9 fallback + the trailing "Be honest"
    // bullet — at least one mention each of the three native tools.
    expect(body).toMatch(/pending-manual-registration/);
    expect(body).toMatch(/the\s+same\s+text\s+inline\s+in\s+chat/);
    expect(body).toMatch(/Never\s+crash\s+the\s+flow\s+on\s+a\s+missing\s+host\s+tool/);
  });
});

describe("onboard-team-lead.md — consent text version + member record", () => {
  it("stamps the v1-2026-05-12 consent text version for the lead's record", () => {
    expect(body).toMatch(/consent_text_version:\s*v1-2026-05-12/);
  });

  it("writes the team-lead member file under data/members/", () => {
    expect(body).toMatch(
      /<root>\/teams\/\{team-slug\}\/data\/members\/\{lead-user-slug\}\.md/,
    );
  });

  it("defaults the team-lead's relevance_classes to every Step-3 slug", () => {
    expect(body).toMatch(/leads\s+default\s+to\s+all\s+classes/);
  });
});

describe("onboard-team-lead.md — Step 10 marker frontmatter", () => {
  it("declares the marker type", () => {
    expect(body).toMatch(/type:\s*team-lead-onboarding-progress/);
  });

  it("records relevance_class_count and entity_subtype_count", () => {
    expect(body).toMatch(/relevance_class_count/);
    expect(body).toMatch(/entity_subtype_count/);
  });

  it("flips onboarding_complete to true on final write", () => {
    expect(body).toMatch(/onboarding_complete:\s*true/);
  });
});

describe("onboard-team-lead.md — voice + authoring rules", () => {
  it("forbids the canonical internal-vocab words", () => {
    const forbidden = [
      "Mode A",
      "subagent",
      "router",
      "dispatch",
      "schema_version",
      "subtype",
      "action_class",
    ];
    for (const w of forbidden) {
      expect(body, `voice rules name ${w} as forbidden`).toMatch(
        new RegExp(`Never say.*${w}|"${w}"`, "s"),
      );
    }
  });

  it("explicitly bans WebSearch and the 'walk through a typical day' question", () => {
    expect(body).toMatch(/do\s+NOT\s+`WebSearch`/);
    expect(body).toMatch(/walk\s+through\s+a\s+typical\s+day/);
  });

  it("references the P7 additive-only schema policy in edit mode", () => {
    expect(body).toMatch(/additive-only per P7/);
    expect(body).toMatch(/MAJOR is forbidden/);
    expect(body).toMatch(/\/agntux-teams reshape \{team-slug\}/);
  });
});
