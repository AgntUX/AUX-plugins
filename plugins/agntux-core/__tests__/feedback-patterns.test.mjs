/**
 * feedback-patterns.test.mjs
 *
 * Subagent-level tests for the feedback subagent (P4 §10).
 * Strategy: assert that agents/feedback.md contains the required
 * pattern emission keywords and graduation tagging logic.
 *
 * Limitation: keyword/structural tests only. Full LLM pattern-detection
 * simulation is not feasible at MVP without a running host.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEEDBACK_MD = join(PLUGIN_ROOT, "agents", "pattern-feedback.md");

describe("pattern-feedback agent file exists", () => {
  it("agents/pattern-feedback.md exists", () => {
    expect(existsSync(FEEDBACK_MD)).toBe(true);
  });
});

describe("pattern-feedback agent frontmatter", () => {
  it("has name: pattern-feedback", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toMatch(/^name: pattern-feedback/m);
  });

  it("description mentions pattern detection", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toMatch(/pattern.*detection|Auto-learned/i);
  });
});

describe("pattern emission", () => {
  it("specifies 5 pattern dimensions", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    // All 5 dimensions: reason_class, source, related_entities, time-of-day, specific entity
    expect(s).toMatch(/reason_class/);
    expect(s).toMatch(/source/);
    expect(s).toMatch(/related_entities/);
    expect(s).toMatch(/time.of.day/i);
  });

  it("specifies minimum pattern threshold (N)", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toMatch(/feedback_min_pattern_threshold|threshold/i);
    expect(s).toMatch(/default.*5|5.*default/i);
  });

  it("appends to # Auto-learned section", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toContain("# Auto-learned");
    expect(s).toMatch(/append/i);
  });

  it("bullet format: observation → recommended adjustment", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toMatch(/→.*adjustment|observation.*→/i);
  });
});

describe("graduation tagging", () => {
  it("mentions [graduation-candidate] tag", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toContain("[graduation-candidate]");
  });

  it("specifies 7-consecutive-day criterion", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toMatch(/7.*consecutive|consecutive.*7/i);
  });

  it("does NOT propose or edit # Preferences (authority discipline)", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    // Feedback subagent must not edit Preferences — it only tags candidates
    expect(s).toMatch(/You never|never.*edit.*Preferences|tag.*don.t.*graduate/i);
  });
});

describe("authority discipline", () => {
  it("only writes to # Auto-learned", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toMatch(/only write.*Auto-learned|Auto-learned.*only/i);
  });

  it("specifies 30-day window", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toMatch(/30.day|30 day/i);
  });
});

describe("dismissal interpretation (4.3.0 — outcome-marker rules)", () => {
  it("documents the new 'How to read dismissals' section", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toContain("How to read dismissals");
  });

  it("calls out that bare dismissals are ambiguous (not deprioritize signal)", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toMatch(/[Bb]are dismissal[^\n]+ambiguous/);
    expect(s).toMatch(/[Bb]are dismissals do NOT contribute|[Dd]oes NOT contribute to deprioritize/);
  });

  it("treats `## Outcome: completed-externally` as a positive (trust-more) signal", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toContain("completed-externally");
    expect(s).toMatch(/positive.*signal|trust this signal more/);
  });

  it("treats `## Auto-resolved` (status: done from agntux-slack Step 8.5) as a positive signal", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toContain("## Auto-resolved");
    expect(s).toMatch(/Step 8\.5/);
    expect(s).toMatch(/positive signal/);
  });

  it("treats `## Outcome: noise` (or irrelevant) as a deprioritize signal", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toMatch(/Outcome: noise/);
    expect(s).toMatch(/counts toward `→ deprioritize`/);
  });

  it("treats dismissal paired with a `# Never raise` capture (within ±24h) as a deprioritize signal", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toContain("# Never raise");
    expect(s).toMatch(/±24h/);
  });

  it("buckets dismissals as completion-elsewhere | noise-marker | never-raise-paired | bare", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    expect(s).toContain("completion-elsewhere");
    expect(s).toContain("noise-marker");
    expect(s).toContain("never-raise-paired");
    expect(s).toContain("bare");
  });

  it("examples explicitly carry an intent marker on dismissal-count bullets", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    // The "Append to # Auto-learned" examples must show outcome markers.
    expect(s).toMatch(/dismissals \(with "## Outcome: noise"\)/);
    // The graduation-candidate example also carries the marker.
    expect(s).toMatch(/dismissals \(with "## Outcome: noise"\)[^\n]*\[graduation-candidate/);
  });

  it("does NOT carry the legacy bare-dismissal deprioritize example", () => {
    const s = readFileSync(FEEDBACK_MD, "utf8");
    // The pre-4.3.0 example was: "5 dismissals on reason_class: knowledge-update from acme-marketing → deprioritize"
    // (no outcome marker). The new examples MUST always include an intent marker.
    expect(s).not.toMatch(/^- 5 dismissals on reason_class: knowledge-update from acme-marketing → deprioritize$/m);
  });
});
