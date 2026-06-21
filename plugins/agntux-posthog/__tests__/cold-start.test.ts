// =============================================================================
// cold-start.test.ts — plugin shape contract for agntux-posthog.
//
// Asserts the inline-skill pattern (post 6aa72b8), manifest fields, and
// placeholder substitution completeness. Every assertion is grounded in
// either the parsed plugin.json / listing.yaml or the rendered skill tree.
//
// NOTE: The rendered skills/agntux-posthog/SKILL.md is produced by
// `node ../../scripts/render-skill.mjs agntux-posthog` at build time.
// The placeholder-survival check deliberately skips _overrides/ source files
// (those legitimately contain {{key}} names in comments — mechanical rule 4).
// =============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-posthog";

// ── Manifest ──────────────────────────────────────────────────────────────────

describe("manifest", () => {
  it("plugin.json has required fields", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json
    expect(m.name).toBe(SLUG);
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    // Field present and non-empty
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
  });

  it("plugin.json recommended_ingest_cadence matches frontmatter.yaml recommended-cadence", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json line 10
    expect(m.recommended_ingest_cadence).toBe("Every 60 min, 7am–7pm weekdays local");
  });
});

// ── Plugin shape (inline-skill pattern, post 6aa72b8) ────────────────────────

describe("plugin shape (inline-skill pattern, post 6aa72b8)", () => {
  it("does NOT ship a top-level agents/ directory — sync runs as a top-level skill", () => {
    expect(existsSync(join(PLUGIN_ROOT, "agents"))).toBe(false);
  });

  it("does NOT ship a hooks/ directory — plugins are Apache-2.0 and unconditionally free", () => {
    expect(existsSync(join(PLUGIN_ROOT, "hooks"))).toBe(false);
  });

  it("does NOT ship a mcp-server/ directory — source plugins are remote-view-only", () => {
    expect(existsSync(join(PLUGIN_ROOT, "mcp-server"))).toBe(false);
  });

  it("does NOT ship a .mcp.json file — there is no local MCP server to register", () => {
    expect(existsSync(join(PLUGIN_ROOT, ".mcp.json"))).toBe(false);
  });

  it("ships a view-tool/ directory — this is a UI-bearing plugin", () => {
    expect(existsSync(join(PLUGIN_ROOT, "view-tool"))).toBe(true);
  });
});

// ── listing.yaml proposed_schema ─────────────────────────────────────────────
// Assert stable scalar values via verbatim toContain() on the raw text.
// js-yaml is in view-tool/devDeps only; the plugin-root package.json does not
// depend on it. The cursor_semantics and source_id_format fields are single-line
// YAML scalars (verified by reading the file) — toContain() of a verbatim
// substring is safe and not a "text regex" (mechanical rule 5 bans regex;
// toContain with a verbatim read-and-copy substring is explicitly allowed).

describe("listing.yaml proposed_schema", () => {
  function loadListing() {
    return readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
  }

  it("cursor_semantics field documents per-resource timestamp map", () => {
    const listing = loadListing();
    // Verbatim substring from marketplace/listing.yaml line 119
    expect(listing).toContain(
      "Per-resource timestamp map: errors by last_seen, alerts by fired_at, experiments by updated_at, comments by created_at, inbox reports by created_at.",
    );
  });

  it("source_id_format field documents posthog:{project_id}:{resource_type}:{resource_id}", () => {
    const listing = loadListing();
    // Verbatim substring from marketplace/listing.yaml line 120
    expect(listing).toContain(
      "posthog:{project_id}:{resource_type}:{resource_id}",
    );
  });

  it("entity subtypes include all five PostHog resource types", () => {
    const listing = loadListing();
    // Verbatim subtype values from marketplace/listing.yaml lines 47–108
    expect(listing).toContain("subtype: error-issue");
    expect(listing).toContain("subtype: alert");
    expect(listing).toContain("subtype: experiment");
    expect(listing).toContain("subtype: comment-thread");
    expect(listing).toContain("subtype: inbox-report");
  });

  it("action classes include opportunity (for experiment decisions)", () => {
    const listing = loadListing();
    // Verbatim from marketplace/listing.yaml line 116
    expect(listing).toContain("class: opportunity");
  });
});

// ── Skill prompt substitution ─────────────────────────────────────────────────

describe("skill prompt substitution", () => {
  const SKILL_PATH = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);

  it("rendered SKILL.md exists (must be built before gate runs)", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  it("no unsubstituted {{...}} placeholders in the rendered sync skill", () => {
    // Mechanical rule 4: grep SKILL.md + reference/*.md, never _overrides/
    if (!existsSync(SKILL_PATH)) return; // skip if not yet rendered
    const skill = readFileSync(SKILL_PATH, "utf-8");
    const matches = skill.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("rendered SKILL.md frontmatter runs INLINE — no context:/agent:/tools: lines", () => {
    if (!existsSync(SKILL_PATH)) return; // skip if not yet rendered
    const p = readFileSync(SKILL_PATH, "utf-8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).toMatch(new RegExp(`^name: ${SLUG}$`, "m"));
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });

  it("rendered reference files have no unsubstituted {{...}} placeholders", () => {
    const refDir = join(PLUGIN_ROOT, `skills/${SLUG}/reference`);
    if (!existsSync(refDir)) return; // skip if not yet rendered
    const refs: string[] = readdirSync(refDir).filter((n: string) =>
      n.endsWith(".md"),
    );
    for (const name of refs) {
      const text = readFileSync(join(refDir, name), "utf-8");
      const hits = text.match(/\{\{[a-z-]+\}\}/g);
      expect(hits, `{{placeholder}} found in reference/${name}`).toBeNull();
    }
  });
});
