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
