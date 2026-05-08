/**
 * absorbed-skills.test.mjs
 *
 * Two-phase regression guard.
 *
 * Phase 1 (7.0.0 — de-fork sweep): the six legacy `agents/*.md` files
 * (retrieval, personalization, data-architect, pattern-feedback,
 * user-feedback, _sources) were absorbed into the entry-point skills
 * that used to dispatch them via `Task`.
 *
 * Phase 2 (8.0.0 — single-skill consolidation): the eight
 * `agntux-{ask,feedback-review,onboard,profile,schema,sync,teach,triage}/`
 * directories were absorbed into one router at
 * `skills/agntux/SKILL.md` plus per-sub-task resources under
 * `skills/agntux/reference/{name}.md`. Authority-discipline rules,
 * mode/stage shapes, and pattern-detection rules from the absorbed
 * skill bodies must still live in their reference resource — the
 * dispatch hop is gone, but the contracts are preserved verbatim.
 *
 * | Legacy agent             | Phase 1 home (7.0.0)                    | Phase 2 home (8.0.0)                              |
 * |--------------------------|-----------------------------------------|---------------------------------------------------|
 * | agents/retrieval.md      | skills/agntux-ask/SKILL.md              | skills/agntux/reference/ask.md                    |
 * | agents/personalization.md| skills/agntux-{onboard,profile}/SKILL.md| skills/agntux/reference/{onboard,profile}.md      |
 * | agents/data-architect.md | skills/agntux-schema/SKILL.md           | skills/agntux/reference/schema.md                 |
 * | agents/pattern-feedback.md| skills/agntux-feedback-review/SKILL.md | skills/agntux/reference/feedback-review.md        |
 * | agents/user-feedback.md  | skills/agntux-teach/SKILL.md            | skills/agntux/reference/teach.md                  |
 * | agents/_sources.md       | skills/_sources.md                      | skills/_sources.md (unchanged)                    |
 *
 * Limitation: keyword/structural tests against the resource files. Full
 * LLM behaviour simulation is out of scope.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const REFERENCE_DIR = join(SKILLS_DIR, "agntux", "reference");

function readReference(name) {
  return readFileSync(join(REFERENCE_DIR, name), "utf-8");
}

function readSkill(relPath) {
  return readFileSync(join(SKILLS_DIR, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// All six legacy agents/ files are gone (Phase 1 invariant)
// ---------------------------------------------------------------------------

describe("legacy agents/ files have been retired", () => {
  for (const file of [
    "retrieval.md",
    "personalization.md",
    "data-architect.md",
    "pattern-feedback.md",
    "user-feedback.md",
    "_sources.md",
  ]) {
    it(`agents/${file} is gone`, () => {
      expect(existsSync(join(PLUGIN_ROOT, "agents", file))).toBe(false);
    });
  }

  it("the entire agents/ directory is gone (no subagents ship in agntux-core)", () => {
    expect(existsSync(join(PLUGIN_ROOT, "agents"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// All eight legacy `agntux-*` skill directories are gone (Phase 2 invariant)
// ---------------------------------------------------------------------------

describe("legacy agntux-* skill directories have been retired (8.0.0)", () => {
  for (const dir of [
    "agntux-ask",
    "agntux-feedback-review",
    "agntux-onboard",
    "agntux-profile",
    "agntux-schema",
    "agntux-sync",
    "agntux-teach",
    "agntux-triage",
  ]) {
    it(`skills/${dir}/ is gone`, () => {
      expect(existsSync(join(SKILLS_DIR, dir))).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// retrieval → skills/agntux/reference/ask.md
// ---------------------------------------------------------------------------

describe("retrieval absorbed into reference/ask.md", () => {
  const text = readReference("ask.md");

  it("declares the 5 query patterns (Pattern A through E)", () => {
    expect(text).toMatch(/Pattern A/);
    expect(text).toMatch(/Pattern B/);
    expect(text).toMatch(/Pattern C/);
    expect(text).toMatch(/Pattern D/);
    expect(text).toMatch(/Pattern E/);
  });

  it("Pattern A: catch-all triage triggers", () => {
    expect(text).toMatch(/what.*hot|triage|what.*look/i);
  });

  it("Pattern B: entity query triggers", () => {
    expect(text).toMatch(/entity|what.*know.*about|tell.*about/i);
  });

  it("Pattern C: time-window triggers", () => {
    expect(text).toMatch(/this week|today|happened/i);
  });

  it("Pattern D: topic-query triggers", () => {
    expect(text).toMatch(/topic.*query|what.*said.*about|latest on/i);
  });

  it("Pattern E: prep / meeting triggers", () => {
    expect(text).toMatch(/prep|meeting/i);
  });

  it("documents the always-read-first ladder (user.md + actions/_index.md)", () => {
    expect(text).toMatch(/Always read first/);
    expect(text).toContain("user.md");
    expect(text).toContain("actions/_index.md");
  });

  it("documents the freshness check thresholds (36h stale / 8d very stale)", () => {
    expect(text).toMatch(/36 hours/);
    expect(text).toMatch(/8 days/);
  });
});

// ---------------------------------------------------------------------------
// personalization Mode A → skills/agntux/reference/onboard.md
// ---------------------------------------------------------------------------

describe("personalization Mode A absorbed into reference/onboard.md", () => {
  const text = readReference("onboard.md");

  it("description references user.md as the load-bearing artefact", () => {
    expect(text).toContain("user.md");
  });

  it("Stage 0: project root precondition (~/agntux fallback)", () => {
    expect(text).toMatch(/Stage 0/);
    expect(text).toMatch(/~\/agntux/);
  });

  it("Stage 1: Identity (name / email / timezone)", () => {
    expect(text).toMatch(/Stage 1/);
    expect(text).toMatch(/name|role|email/i);
    expect(text).toMatch(/# Identity/);
  });

  it("Stage 2: Responsibilities", () => {
    expect(text).toMatch(/Stage 2/);
    expect(text).toMatch(/Responsibilities/i);
  });

  it("Stage 2.5: Day-to-Day, Aspirations, Goals (added in 4.x)", () => {
    expect(text).toMatch(/Stage 2\.5/);
    expect(text).toMatch(/# Day-to-Day/);
    expect(text).toMatch(/# Aspirations/);
    expect(text).toMatch(/# Goals/);
  });

  it("Stage 3: Preferences (## Always action-worthy / ## Usually noise)", () => {
    expect(text).toMatch(/Stage 3/);
    expect(text).toMatch(/Always action-worthy/);
    expect(text).toMatch(/Usually noise/);
  });

  it("Stage 4: Glossary", () => {
    expect(text).toMatch(/Stage 4/);
    expect(text).toMatch(/Glossary|acronyms|codenames/i);
  });

  it("Stage 4.5: Sources (added in 4.x)", () => {
    expect(text).toMatch(/Stage 4\.5/);
    expect(text).toMatch(/# Sources/);
  });

  it("Stage 4.6: AgntUX plugins with Installed/Planned subsections", () => {
    expect(text).toMatch(/Stage 4\.6/);
    expect(text).toMatch(/AgntUX (ingest )?plugins/);
    expect(text).toMatch(/## Installed/);
    expect(text).toMatch(/## Planned/);
    expect(text).toMatch(/lowercase[,\s]+hyphenated/i);
  });

  it("Stage 5: frontmatter finalisation (type: user-config + canonical fields)", () => {
    expect(text).toMatch(/Stage 5/);
    expect(text).toMatch(/type: user-config/);
    expect(text).toMatch(/timezone/);
    expect(text).toMatch(/bootstrap_window_days/);
    expect(text).toMatch(/feedback_min_pattern_threshold/);
    expect(text).toMatch(/updated_at/);
  });

  it("bootstrap_window_days default is 30 with range 1-365", () => {
    expect(text).toMatch(/default.*30|30.*default|default `30`/i);
    expect(text).toMatch(/1.{1,5}365/);
  });

  it("feedback_min_pattern_threshold default is 5 with range 3-20", () => {
    expect(text).toMatch(/default.*5|5.*default|default `5`/i);
    expect(text).toMatch(/3.{1,5}20/);
  });

  it("authority discipline table lists user-authored sections", () => {
    expect(text).toMatch(/# Identity/);
    expect(text).toMatch(/# Preferences/);
    expect(text).toMatch(/# Glossary/);
  });

  it("references /agntux teach for source-specific imperatives", () => {
    // Cross-link survives even though the agent-level dispatch is gone
    // and the slash-command was renamed (`/agntux-teach` → `/agntux teach`).
    expect(text).toMatch(/agntux teach|user-feedback/i);
  });
});

// ---------------------------------------------------------------------------
// personalization Modes B/C/D → skills/agntux/reference/profile.md
// ---------------------------------------------------------------------------

describe("personalization Modes B/C/D absorbed into reference/profile.md", () => {
  const text = readReference("profile.md");

  it("Mode B: ongoing edits", () => {
    expect(text).toMatch(/## Mode B.+[Oo]ngoing/);
  });

  it("Mode B special case — cadence change redirect (host scheduled-task UI)", () => {
    expect(text).toMatch(/cadence.*change|change.*cadence/i);
    expect(text).toMatch(/scheduled.task|host.*UI/i);
  });

  it("Mode C: graduation review (reads [graduation-candidate] tags)", () => {
    expect(text).toMatch(/## Mode C.+[Gg]raduation/);
    expect(text).toContain("[graduation-candidate");
  });

  it("Mode C: strips tag after user approval or rejection", () => {
    expect(text).toMatch(/strip.*tag|remove.*tag/i);
  });

  it("Mode D: proactive ask", () => {
    expect(text).toMatch(/## Mode D.+[Pp]roactive/);
  });

  it("authority discipline table lists user-authored sections requiring approval", () => {
    expect(text).toMatch(/# Identity/);
    expect(text).toMatch(/# Preferences/);
    expect(text).toMatch(/# Glossary/);
  });

  it("# Auto-learned is owned by pattern-feedback flow (no autonomous edit by /agntux profile)", () => {
    expect(text).toMatch(/Auto-learned.*pattern-feedback|pattern-feedback.*Auto-learned/i);
  });
});

// ---------------------------------------------------------------------------
// data-architect → skills/agntux/reference/schema.md
// ---------------------------------------------------------------------------

describe("data-architect absorbed into reference/schema.md", () => {
  const text = readReference("schema.md");

  it("documents Mode A — Bootstrap", () => {
    expect(text).toMatch(/Mode A.+[Bb]ootstrap/);
  });

  it("documents Mode B — plugin install review", () => {
    expect(text).toMatch(/Mode B.+[Pp]lugin install review/);
  });

  it("documents Mode C — schema edit", () => {
    expect(text).toMatch(/Mode C.+[Ss]chema edit/);
  });

  it("authority discipline: writes only to data/schema/ and data/schema-{warnings,requests}.md", () => {
    expect(text).toMatch(/data\/schema\//);
    expect(text).toMatch(/schema-warnings\.md/);
    expect(text).toMatch(/schema-requests\.md/);
  });

  it("forbids writes outside the schema lane (user.md / data/instructions / entities / actions)", () => {
    // The new authority table lists these as Read=Yes, Write=No.
    expect(text).toMatch(/user\.md[\s\S]*\|\s*No\s*\|/i);
    expect(text).toMatch(/instructions[\s\S]*\|\s*No\s*\|/i);
    expect(text).toMatch(/entities/i);
  });

  it("Mode A reads each Installed plugin's listing.yaml proposed_schema for sizing", () => {
    expect(text).toMatch(/proposed_schema/);
    expect(text).toMatch(/marketplace\/listing\.yaml/);
  });

  it("Mode A does not preemptively grant ownership for Planned plugins", () => {
    expect(text).toMatch(/Planned[\s\S]*no preemptive ownership grants|Planned[\s\S]*size only/i);
  });

  it("logs migration warnings to data/schema-warnings.md (legacy state/ path retired)", () => {
    expect(text).toMatch(/data\/schema-warnings\.md/);
    expect(text).not.toMatch(/state\/schema-warnings\.md/);
  });

  it("schema-requests.md is read-and-consume (not state/)", () => {
    expect(text).toMatch(/data\/schema-requests\.md/);
    expect(text).not.toMatch(/state\/schema-requests\.md/);
  });
});

// ---------------------------------------------------------------------------
// user-feedback → skills/agntux/reference/teach.md
// ---------------------------------------------------------------------------

describe("user-feedback absorbed into reference/teach.md", () => {
  const text = readReference("teach.md");

  it("documents Mode A — Capture", () => {
    expect(text).toMatch(/## Mode A.+[Cc]apture/);
  });

  it("documents Mode B — Teach interview", () => {
    expect(text).toMatch(/## Mode B.+[Tt]each interview/);
  });

  it("documents Mode C — Structural escalation", () => {
    expect(text).toMatch(/## Mode C.+[Ss]tructural escalation/);
  });

  it("authority surface: writes to data/instructions/{plugin-slug}.md + appends to data/schema-requests.md", () => {
    expect(text).toMatch(/data\/instructions\/\{plugin-slug\}\.md/);
    expect(text).toMatch(/data\/schema-requests\.md/);
  });

  it("forbids writes to user.md / data/schema/ / entities / actions / data/learnings", () => {
    expect(text).toMatch(/`?user\.md`?[\s\S]*never write/i);
    expect(text).toMatch(/data\/schema\//);
  });

  it("captured rules carry source provenance lines (date + origin)", () => {
    expect(text).toMatch(/source: \{YYYY-MM-DD\}/);
  });

  it("escalates structural requests to data/schema-requests.md", () => {
    expect(text).toMatch(/data\/schema-requests\.md/);
    expect(text).not.toMatch(/state\/schema-requests\.md/);
  });
});

// ---------------------------------------------------------------------------
// pattern-feedback → skills/agntux/reference/feedback-review.md
// ---------------------------------------------------------------------------

describe("pattern-feedback absorbed into reference/feedback-review.md", () => {
  const text = readReference("feedback-review.md");

  it("carries an explicit background-only refuse-and-redirect guard", () => {
    // Replaces the 7.x `disable-model-invocation: true` frontmatter
    // (which doesn't apply to a resource — only to a SKILL.md).
    expect(text).toMatch(/[Bb]ackground-only/);
    expect(text).toMatch(/refuse|redirect|exit cleanly/i);
  });

  it("description disambiguates from /agntux teach lane", () => {
    expect(text).toMatch(/pattern.*detection|Auto-learned/i);
    expect(text).toMatch(/agntux teach|user-feedback/i);
  });

  it("specifies 5 pattern dimensions", () => {
    expect(text).toMatch(/reason_class/);
    expect(text).toMatch(/source/);
    expect(text).toMatch(/related_entities/);
    expect(text).toMatch(/time.of.day/i);
  });

  it("specifies the feedback_min_pattern_threshold gate (default 5)", () => {
    expect(text).toMatch(/feedback_min_pattern_threshold/);
    expect(text).toMatch(/default.*`?5`?/i);
  });

  it("documents the 30-day pattern window", () => {
    expect(text).toMatch(/30.day|30 day/i);
  });

  it("appends to # Auto-learned (never inserts mid-list)", () => {
    expect(text).toContain("# Auto-learned");
    expect(text).toMatch(/[Aa]ppend/);
  });

  it("bullet format: observation → recommended adjustment", () => {
    expect(text).toMatch(/observation.*→|→.*adjustment/i);
  });

  it("graduation candidates carry the [graduation-candidate] tag", () => {
    expect(text).toContain("[graduation-candidate");
  });

  it("specifies the 7-consecutive-day graduation criterion", () => {
    expect(text).toMatch(/7.*consecutive|consecutive.*7/i);
  });

  it("never edits # Preferences (authority discipline — only tags candidates)", () => {
    expect(text).toMatch(/never|do NOT/i);
    expect(text).toMatch(/Preferences/);
  });

  it("only writes to # Auto-learned + (threshold-gated) data/schema-requests.md", () => {
    expect(text).toMatch(/only write/i);
    expect(text).toContain("# Auto-learned");
  });

  it("documents the 'How to read dismissals' outcome-marker rules", () => {
    expect(text).toContain("How to read dismissals");
  });

  it("bare dismissals are ambiguous (do NOT contribute to deprioritize)", () => {
    // Wrapping is permitted ("→\n  **ambiguous**.") — match across newlines.
    expect(text).toMatch(/[Bb]are dismissal[\s\S]+?ambiguous/);
    expect(text).toMatch(/[Dd]oes NOT contribute to any pattern/);
  });

  it("treats `## Outcome: completed-externally` as positive signal (trust-more)", () => {
    expect(text).toContain("completed-externally");
    expect(text).toMatch(/positive[\s\S]{0,30}signal|trust this signal more/);
  });

  it("treats ## Auto-resolved (Step 8.5 transition) as positive signal", () => {
    expect(text).toContain("## Auto-resolved");
    // Markdown wraps "**positive** signal" across the bullet (line wrap +
    // bold delimiters); allow either flavour.
    expect(text).toMatch(/\*\*positive\*\*\s+signal|positive\s+signal/);
  });

  it("treats `## Outcome: noise` as deprioritize signal", () => {
    expect(text).toMatch(/Outcome: noise/);
    expect(text).toMatch(/counts toward `→ deprioritize`/);
  });

  it("treats dismissal paired with # Never raise capture (within ±24h) as deprioritize", () => {
    expect(text).toContain("# Never raise");
    expect(text).toMatch(/±24h/);
  });

  it("buckets dismissals as completion-elsewhere | noise-marker | never-raise-paired | bare", () => {
    expect(text).toContain("completion-elsewhere");
    expect(text).toContain("noise-marker");
    expect(text).toContain("never-raise-paired");
    expect(text).toContain("bare");
  });
});

// ---------------------------------------------------------------------------
// _sources.md — kept at skills/ root (unchanged across both phases)
// ---------------------------------------------------------------------------

describe("_sources helper still lives at skills/ root", () => {
  it("skills/_sources.md exists and documents lookup-before-write", () => {
    const text = readSkill("_sources.md");
    expect(text).toMatch(/_sources\.json/);
    expect(text).toMatch(/[Ll]ookup-before-write/);
  });
});
