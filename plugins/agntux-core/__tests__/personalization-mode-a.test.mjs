/**
 * personalization-mode-a.test.mjs
 *
 * Subagent-level tests for personalization Mode A walkthrough (P4 §10).
 * Strategy: assert that agents/personalization.md contains the required
 * stages, frontmatter fields, and authority-discipline table entries.
 *
 * Limitation: keyword/structural tests only. Full LLM interview simulation
 * is not feasible at MVP without a running host. We assert that the prompt
 * file encodes the correct interview stages and validation rules so that a
 * hosted agent following it would produce a valid user.md.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PERSONALIZATION_MD = join(PLUGIN_ROOT, "agents", "personalization.md");

describe("personalization agent file exists", () => {
  it("agents/personalization.md exists", () => {
    expect(existsSync(PERSONALIZATION_MD)).toBe(true);
  });
});

describe("personalization agent frontmatter", () => {
  it("has name: personalization", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/^name: personalization/m);
  });

  it("description mentions user.md", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/user\.md/);
  });
});

describe("Mode A: first-run interview stages", () => {
  it("Stage 0: project root precondition", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/Stage 0/);
    expect(s).toMatch(/~\/agntux\//);
  });

  it("Stage 1: identity questions present", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/Stage 1/);
    expect(s).toMatch(/name|role|email/i);
    expect(s).toMatch(/# Identity/);
  });

  it("Stage 2: responsibilities questions present", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/Stage 2/);
    expect(s).toMatch(/Responsibilities|responsibilities/);
  });

  it("Stage 3: preferences questions present", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/Stage 3/);
    expect(s).toMatch(/Always action-worthy|Usually noise/);
  });

  it("Stage 4: glossary questions present", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/Stage 4/);
    expect(s).toMatch(/Glossary|acronyms|codenames/i);
  });

  it("Stage 5: frontmatter finalization present", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/Stage 5/);
    expect(s).toMatch(/type: user-config/);
    expect(s).toMatch(/timezone/);
    expect(s).toMatch(/bootstrap_window_days/);
    expect(s).toMatch(/feedback_min_pattern_threshold/);
    expect(s).toMatch(/updated_at/);
  });

  it("Stage 4.6: AgntUX plugins interview", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/Stage 4\.6/);
    expect(s).toMatch(/AgntUX (ingest )?plugins/);
    expect(s).toMatch(/already (have )?installed|already installed/i);
    expect(s).toMatch(/plan to install|want to install/i);
  });

  it("Stage 4.6: writes Installed and Planned subsections", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/## Installed/);
    expect(s).toMatch(/## Planned/);
    expect(s).toMatch(/lowercase, hyphenated/i);
  });

  it("Stage 4.6: skip-with-empty-section discipline (no placeholders)", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/heading only/);
    expect(s).toMatch(/do NOT add placeholder bullets|don.{1,3}t add placeholder/i);
  });
});

describe("Plugin suggestions block updates # AgntUX plugins", () => {
  // 4.0.0 simplified the post-Stage-5 plugin-suggestions block. The
  // numbered Connector-vs-npm-branch step was folded into the per-source
  // scheduled-task walkthrough (which still includes the branch logic).
  // The block now lives downstream of a Connect-your-sources gate and a
  // Per-plugin onboarding interview. Tests below verify the surviving
  // semantics, not the old step numbering.

  it("plugin-suggestions block + per-source walkthrough still document Connector vs npm branch", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/Connector branch/);
    expect(s).toMatch(/npm branch/);
  });

  it("filters suggestions against ## Installed and ## Planned", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    // Phrasing simplified in 4.0.0 — drop already-installed slugs;
    // re-confirm already-planned slugs.
    expect(s).toMatch(/Drop any slug already on `## Installed`/);
    expect(s).toMatch(/already on `## Planned`/);
  });

  it("promotes Planned → Installed on install confirmation", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/add to `## Installed`/);
    expect(s).toMatch(/remove from `## Planned`/);
  });

  it("declined plugins do NOT log rejection bookkeeping", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    // 4.0.0: phrasing simplified to "Do NOT write rejection bookkeeping".
    expect(s).toMatch(/Do NOT (add|write) rejection bookkeeping/);
  });
});

describe("Mode A: synthetic user input → resulting user.md fields", () => {
  it("writes Identity section with labeled bullets", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/Name:|Role:|Email:/);
  });

  it("bootstrap_window_days default is 30", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/default.*30|30.*default/i);
  });

  it("bootstrap_window_days range is 1-365", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/1.{1,5}365/);
  });

  it("feedback_min_pattern_threshold default is 5", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/default.*5|5.*default/i);
  });

  it("feedback_min_pattern_threshold range is 3-20", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/3.{1,5}20/);
  });

  it("saves partial progress after each stage", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/Save.*disk|disk.*before continuing/i);
  });
});

describe("Mode B: ongoing edits", () => {
  it("cadence-change redirect message present", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/cadence.*change|change.*cadence/i);
    expect(s).toMatch(/host.*UI|scheduled.task.*UI/i);
  });
});

describe("Mode C: graduation review", () => {
  it("reads [graduation-candidate] tags", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toContain("[graduation-candidate");
  });

  it("strips tag after user approval or rejection", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/strip.*tag|remove.*tag/i);
  });
});

describe("authority discipline table", () => {
  it("lists user-authored sections that require approval", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/# Identity/);
    expect(s).toMatch(/# Preferences/);
    expect(s).toMatch(/# Glossary/);
  });

  it("# Auto-learned is agent-authored (no approval needed)", () => {
    const s = readFileSync(PERSONALIZATION_MD, "utf8");
    expect(s).toMatch(/Auto-learned.*autonomous|autonomous.*Auto-learned/i);
  });
});
