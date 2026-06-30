// cold-start.test.ts — manifest shape + skill substitution for agntux-granola.
//
// Assertions are grounded in ground truth #1/#2 only:
//   1. .claude-plugin/plugin.json (parsed JSON)
//   2. marketplace/listing.yaml (parsed YAML via js-yaml)
//   3. skills/agntux-granola/SKILL.md + reference/*.md (rendered tree,
//      skipped with a warning when not yet rendered)
//
// E30 guard: ZERO assertions touch _overrides/ source files or
// data/instructions/*.md.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-granola";

// ── Manifest ──────────────────────────────────────────────────────────────────

describe("manifest", () => {
  it("plugin.json has required fields", () => {
    // Verbatim values read from .claude-plugin/plugin.json
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(m.name).toBe("agntux-granola");
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
    // Verbatim from plugin.json recommended_ingest_cadence
    expect(m.recommended_ingest_cadence).toBe(
      "Every 30 min, 7am–7pm weekdays local",
    );
  });

  it("listing.yaml proposed_schema.cursor_semantics is a non-empty string", () => {
    // Assert via parsed YAML object, not text regex (mechanical rule 5)
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    expect(typeof ps.cursor_semantics).toBe("string");
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics
    expect(ps.cursor_semantics as string).toContain(
      "Single timestamp cursor",
    );
  });

  it("listing.yaml proposed_schema.source_id_format documents meeting_id", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    expect(typeof ps.source_id_format).toBe("string");
    // Verbatim substring from listing.yaml proposed_schema.source_id_format
    expect(ps.source_id_format as string).toContain("meeting_id");
  });

  it("listing.yaml proposed_schema.action_classes declares the correct class names", () => {
    // Assert via parsed YAML object
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    const classes = ps.action_classes as Array<Record<string, unknown>>;
    expect(Array.isArray(classes)).toBe(true);
    // Verbatim class names from listing.yaml proposed_schema.action_classes
    const classNames = classes.map((c) => c.class as string);
    expect(classNames).toContain("response-needed");
    expect(classNames).toContain("knowledge-update");
  });

  it("listing.yaml proposed_schema.entity_subtypes declares person and topic", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    const subtypes = ps.entity_subtypes as Array<Record<string, unknown>>;
    expect(Array.isArray(subtypes)).toBe(true);
    const subtypeNames = subtypes.map((s) => s.subtype as string);
    // Verbatim subtype names from listing.yaml proposed_schema.entity_subtypes
    expect(subtypeNames).toContain("person");
    expect(subtypeNames).toContain("topic");
  });

  it("listing.yaml requires_source_mcp connector_slug is 'granola'", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const rsMcp = listing.requires_source_mcp as Record<string, unknown>;
    // Verbatim from listing.yaml requires_source_mcp.connector_slug
    expect(rsMcp.connector_slug).toBe("granola");
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

  it("does NOT ship a view-tool/ directory — read-only ingest-only source", () => {
    // Granola is read-only: no write tools, no UI handler, no view-tool.
    expect(existsSync(join(PLUGIN_ROOT, "view-tool"))).toBe(false);
  });
});

// ── Skill prompt substitution (rendered tree) ─────────────────────────────────
// The rendered tree (skills/agntux-granola/SKILL.md + reference/) is produced
// by the gate's render-skill.mjs step BEFORE vitest runs. If the file doesn't
// exist (pre-render cold run), the test skips with a warning rather than
// hard-failing, so CI doesn't confuse a missing render with a
// placeholder-survival error.

describe("skill prompt substitution", () => {
  it("no unsubstituted {{...}} placeholders in the rendered sync skill", () => {
    const skillPath = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);
    if (!existsSync(skillPath)) {
      console.warn(
        `cold-start: skipping placeholder check — ${skillPath} not found (run render-skill.mjs first)`,
      );
      return;
    }
    const p = readFileSync(skillPath, "utf-8");
    // Only check the rendered SKILL.md, never the _overrides source (E30).
    const matches = p.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("no unsubstituted {{...}} placeholders in the rendered reference files", () => {
    const refDir = join(PLUGIN_ROOT, `skills/${SLUG}/reference`);
    if (!existsSync(refDir)) {
      console.warn(
        `cold-start: skipping reference placeholder check — ${refDir} not found`,
      );
      return;
    }
    const files = readdirSync(refDir).filter((n) => n.endsWith(".md"));
    for (const f of files) {
      const content = readFileSync(join(refDir, f), "utf-8");
      const matches = content.match(/\{\{[a-z-]+\}\}/g);
      expect(
        matches,
        `unsubstituted placeholder in reference/${f}`,
      ).toBeNull();
    }
  });

  it("rendered SKILL.md frontmatter runs INLINE — no context:/agent:/tools: lines", () => {
    const skillPath = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);
    if (!existsSync(skillPath)) {
      console.warn(
        `cold-start: skipping frontmatter check — ${skillPath} not found`,
      );
      return;
    }
    const p = readFileSync(skillPath, "utf-8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).toMatch(new RegExp(`^name: ${SLUG}$`, "m"));
    // The forked-context patterns are retired — they broke "Allow for all
    // scheduled runs" inheritance. The renderer (canonical sync template) emits
    // none of these lines; this test catches anyone re-adding them by hand.
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });
});
