// Structural tests for the leader onboarding skill body
// (reference/onboard-leader.md).
//
// The skill body is markdown prose read at runtime by the LLM, not code,
// so we can't unit-test "behaviour" the way we would for a hook module.
// We CAN test the prose's structural commitments — the line cap, the
// six-step shape, the API surface it references, the empty-subscription
// exit path, the rule-body shape it tells the leader to author, and the
// persistence target. If any of those drift the runtime contract breaks
// even though the prose itself "still reads fine", so locking them down
// here catches regressions during refactors.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_BODY_PATH = join(
  __dirname,
  "..",
  "skills",
  "agntux-teams",
  "reference",
  "onboard-leader.md",
);
const SKILL_MD_PATH = join(
  __dirname,
  "..",
  "skills",
  "agntux-teams",
  "SKILL.md",
);

let body;
let bodyLines;

beforeAll(() => {
  expect(existsSync(SKILL_BODY_PATH), "skill body file must exist").toBe(true);
  body = readFileSync(SKILL_BODY_PATH, "utf8");
  bodyLines = body.split("\n");
});

describe("onboard-leader.md — file shape", () => {
  it("is at most 500 lines (lint pass 8 constraint)", () => {
    expect(bodyLines.length).toBeLessThanOrEqual(500);
  });

  it("uses the `/agntux-teams onboard:leader {view-slug}` heading", () => {
    expect(bodyLines[0]).toContain("onboard:leader");
    expect(bodyLines[0]).toContain("{view-slug}");
  });

  it("no longer carries the STUB marker", () => {
    expect(body).not.toMatch(/STUB\s*[—-]\s*S5\.3/i);
    expect(body).not.toMatch(/^>\s*\*\*STUB/m);
  });
});

describe("onboard-leader.md — six-step structure", () => {
  const requiredHeadings = [
    "## Step 0 — Preflight",
    "## Step 1 — Briefing card",
    "## Step 2 — Cross-team relevance filter",
    "## Step 3 — Aggregate vs pointer bias",
    "## Step 4 — Cadence picker",
    "## Step 5 — Register the leader-view scheduled task",
    "## Step 6 — Persist + summary + marker",
  ];

  for (const heading of requiredHeadings) {
    it(`contains the heading "${heading}"`, () => {
      expect(body).toContain(heading);
    });
  }

  it("orders the six step headings sequentially", () => {
    const indices = requiredHeadings.map((h) => body.indexOf(h));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });
});

describe("onboard-leader.md — preflight gates", () => {
  it("references the leader-views status API endpoint", () => {
    expect(body).toMatch(
      /\/api\/teams\/\{org-slug\}\/leader-views\/\{view-slug\}\/status/,
    );
  });

  it("describes the empty-subscriptions exit path with no file writes", () => {
    expect(body).toMatch(/subscribed_team_count\s*===?\s*0/);
    expect(body).toMatch(/No teams subscribed\s+yet/);
    expect(body).toMatch(/No writes\./);
  });

  it("authenticates the status API with license_jwt, not session_jwt", () => {
    expect(body).toMatch(/Bearer\s+\{license_jwt/);
    expect(body).not.toMatch(/session_jwt/);
  });

  it("checks teams.json.leader_views[] for owner: true", () => {
    expect(body).toContain("teams.json.leader_views");
    expect(body).toContain("owner: true");
  });

  it("requires every subscribed team to be onboarded before continuing", () => {
    expect(body).toMatch(/onboarding_complete:\s*true/);
    expect(body).toMatch(/onboard:team-lead/);
  });

  it("delegates to /agntux onboard when user.md is missing", () => {
    expect(body).toMatch(/user\.md/);
    expect(body).toMatch(/\/agntux onboard/);
  });
});

describe("onboard-leader.md — interview shape", () => {
  it("emits the briefing card via mcp__cowork__create_artifact", () => {
    expect(body).toContain("mcp__cowork__create_artifact");
  });

  it("offers aggregate / balanced / pointer as the bias choices", () => {
    expect(body).toMatch(/aggregate_bias/);
    expect(body).toMatch(/Mostly aggregate/);
    expect(body).toMatch(/Balanced/);
    expect(body).toMatch(/Mostly pointers/);
  });

  it("uses aggregate_bias (not aggregate) as the stored key in the bias table", () => {
    expect(body).toMatch(/aggregate_bias:\s*aggregate/);
    expect(body).toMatch(/aggregate_bias:\s*balanced/);
    expect(body).toMatch(/aggregate_bias:\s*pointer/);
  });

  it("uses AskUserQuestion for the bias picker", () => {
    expect(body).toContain("AskUserQuestion");
  });

  it("defaults cadence to the slowest cadence among subscribed teams", () => {
    expect(body).toMatch(/slowest cadence/);
  });

  it("requires at least one alerting rule before advancing", () => {
    expect(body).toMatch(/at\s+least\s+one\s+(saved\s+)?(alerting\s+)?rule/i);
  });
});

describe("onboard-leader.md — rule body shape (P7)", () => {
  it("teaches the '## Rule:' / Triggers when / Action body should / Cadence shape", () => {
    expect(body).toContain("## Rule:");
    expect(body).toContain("**Triggers when**");
    expect(body).toContain("**Action body should**");
    expect(body).toContain("**Cadence**");
  });

  it("instructs the skill to synthesise rules, never let the leader type raw markdown", () => {
    expect(body).toMatch(/never\s+let\s+the\s+leader\s+type\s+raw\s+markdown/i);
  });

  it("covers standing questions as an optional step", () => {
    expect(body).toMatch(/Standing question/);
  });

  it("notes pointers are dropped per P7 (every action is self-contained)", () => {
    expect(body).toMatch(/Pointers are dropped/i);
  });
});

describe("onboard-leader.md — scheduled-task registration (Step 5)", () => {
  it("calls mcp__scheduled-tasks__create_scheduled_task", () => {
    expect(body).toContain("mcp__scheduled-tasks__create_scheduled_task");
  });

  it("uses the canonical taskId pattern agntux-teams-leader-view-{view-slug}", () => {
    expect(body).toMatch(/agntux-teams-leader-view-\{view-slug\}/);
  });

  it("uses the /agntux-teams sync leader:{view-slug} dispatch prompt", () => {
    expect(body).toMatch(/\/agntux-teams sync leader:\{view-slug\}/);
  });

  it("persists scheduled_task_id to view-config frontmatter", () => {
    expect(body).toContain("scheduled_task_id");
  });

  it("updates the existing task on re-entry rather than delete+recreate", () => {
    expect(body).toMatch(
      /mcp__scheduled-tasks__update_scheduled_task|update.*cronExpression/i,
    );
    expect(body).toMatch(/Do not delete \+ recreate/i);
  });

  it("handles MCP failure by persisting Steps 1–4 with onboarding_step: 5", () => {
    expect(body).toMatch(/On MCP failure/i);
    expect(body).toMatch(/onboarding_step:\s*5/);
    expect(body).toMatch(/onboarding_complete:\s*\n?\s*false/);
  });
});

describe("onboard-leader.md — persistence (Step 6)", () => {
  it("writes view-config.md at the canonical leader-views path", () => {
    expect(body).toContain(
      "<root>/leader-views/{view-slug}/data/view-config.md",
    );
  });

  it("emits the required frontmatter keys", () => {
    const requiredKeys = [
      "view_slug:",
      "view_id:",
      "display_name:",
      "owner_user_slug:",
      "subscribed_teams:",
      "relevance_filter:",
      "aggregate_bias:",
      "cadence:",
      "cron:",
      "scheduled_task_id:",
      "schema_version:",
      "onboarding_complete:",
    ];
    for (const key of requiredKeys) {
      expect(body).toContain(key);
    }
  });

  it("persists BOTH cron and cadence so sync.md's due-check works", () => {
    expect(body).toMatch(/cron:\s*<cron/);
    expect(body).toMatch(/cadence:\s*<duration/);
    expect(body).toMatch(/Persist\s+\*\*both\*\*\s+keys/i);
  });

  it("drops a completion marker at <root>/leader-views/{view-slug}/.onboarded", () => {
    expect(body).toContain(".onboarded");
  });

  it("emits a summary artifact card on success", () => {
    const stepSixIdx = body.indexOf("## Step 6");
    const summarySliceIdx = body.indexOf("Summary card", stepSixIdx);
    expect(summarySliceIdx).toBeGreaterThan(stepSixIdx);
    const slice = body.slice(stepSixIdx);
    expect(slice).toContain("mcp__cowork__create_artifact");
  });
});

describe("onboard-leader.md — edit semantics + out-of-scope", () => {
  it("documents re-entry / edit mode behaviour", () => {
    expect(body).toMatch(/Edit semantics|re-entry/i);
  });

  it("punts subscription management to the web app", () => {
    expect(body).toMatch(
      /app\.agntux\.ai\/org\/\{org-slug\}\/leader-views\/\{view-slug\}/,
    );
    expect(body).toMatch(/Org Admin/);
  });

  it("declares cross-org leader views out of scope (P6 identity model)", () => {
    expect(body).toMatch(/Cross-org|within one org/i);
  });

  it("declares an Out of scope section", () => {
    expect(body).toContain("## Out of scope");
  });
});

describe("SKILL.md — routing table is kept in sync", () => {
  it("references onboard-leader.md and no longer marks it STUB", () => {
    const skillMd = readFileSync(SKILL_MD_PATH, "utf8");
    expect(skillMd).toContain("reference/onboard-leader.md");
    const leaderRow = skillMd
      .split("\n")
      .find((l) => l.includes("onboard:leader"));
    expect(leaderRow).toBeDefined();
    expect(leaderRow).not.toMatch(/STUB/);
  });
});
