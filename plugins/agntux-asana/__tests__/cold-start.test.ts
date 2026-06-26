/**
 * cold-start.test.ts
 *
 * Contract-shape validation for the agntux-asana plugin.
 * Every assertion is derived from files read at authoring time.
 * Source files noted inline for each assertion.
 *
 * Golden rule obeyed throughout:
 *   - toContain targets are verbatim substrings from the actual authored file.
 *   - listing.yaml assertions use parsed YAML objects (mechanical rule 5).
 *   - No toContain on _overrides/** files (E30 rule).
 *   - Skill-substitution tests skip gracefully when the rendered file is absent
 *     (render step runs before vitest in the gate; skip protects local runs).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-asana";
const SKILL_PATH = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);
const SKILL_EXISTS = existsSync(SKILL_PATH);

// ---------------------------------------------------------------------------
// manifest (.claude-plugin/plugin.json)
// Derived from: .claude-plugin/plugin.json
// ---------------------------------------------------------------------------
describe("manifest", () => {
  it("plugin.json has required fields", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // name from plugin.json line 2
    expect(m.name).toBe(SLUG);
    // version from plugin.json line 3
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    // recommended_ingest_cadence from plugin.json line 7
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
  });

  it("plugin.json cadence value matches authored string", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json line 7
    expect(m.recommended_ingest_cadence).toBe(
      "Every 60 min, 7am–7pm weekdays local",
    );
  });

  it("plugin.json license is Apache-2.0", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json line 6
    expect(m.license).toBe("Apache-2.0");
  });

  it("plugin.json description is a non-empty string", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // From .claude-plugin/plugin.json line 4
    expect(typeof m.description).toBe("string");
    expect(m.description.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// plugin shape (inline-skill pattern, post 6aa72b8)
// Derived from: directory tree (absence assertions)
// ---------------------------------------------------------------------------
describe("plugin shape (inline-skill pattern, post 6aa72b8)", () => {
  it("does NOT ship a top-level agents/ directory", () => {
    expect(existsSync(join(PLUGIN_ROOT, "agents"))).toBe(false);
  });

  it("does NOT ship a hooks/ directory", () => {
    expect(existsSync(join(PLUGIN_ROOT, "hooks"))).toBe(false);
  });

  it("does NOT ship a mcp-server/ directory", () => {
    expect(existsSync(join(PLUGIN_ROOT, "mcp-server"))).toBe(false);
  });

  it("does NOT ship a .mcp.json file", () => {
    expect(existsSync(join(PLUGIN_ROOT, ".mcp.json"))).toBe(false);
  });

  it("ships a view-tool/ directory (UI-bearing plugin)", () => {
    expect(existsSync(join(PLUGIN_ROOT, "view-tool"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listing.yaml — parsed object assertions (mechanical rule 5: never text-regex)
// Derived from: marketplace/listing.yaml
// ---------------------------------------------------------------------------
describe("listing.yaml shape", () => {
  function loadListing(): Record<string, unknown> {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    return yaml.load(raw) as Record<string, unknown>;
  }

  it("declares exactly 4 ui_components", () => {
    // ui_components from listing.yaml lines 23-43: comment, complete, assign, create
    const components = loadListing().ui_components as unknown[];
    expect(Array.isArray(components)).toBe(true);
    expect(components).toHaveLength(4);
  });

  it("ui_component names include comment, complete, assign, create", () => {
    // From listing.yaml lines 24, 30, 36, 40
    const components = loadListing().ui_components as Array<{ name: string }>;
    const names = components.map((c) => c.name);
    expect(names).toContain("comment");
    expect(names).toContain("complete");
    expect(names).toContain("assign");
    expect(names).toContain("create");
  });

  it("proposed_schema.cursor_semantics is a non-empty string", () => {
    // From listing.yaml line 79
    const schema = loadListing().proposed_schema as Record<string, unknown>;
    expect(typeof schema.cursor_semantics).toBe("string");
    expect((schema.cursor_semantics as string).length).toBeGreaterThan(0);
  });

  it("proposed_schema.source_id_format mentions gid", () => {
    // Verbatim from listing.yaml line 80:
    // "`{gid}` — Asana's globally unique task identifier."
    const schema = loadListing().proposed_schema as Record<string, unknown>;
    expect(typeof schema.source_id_format).toBe("string");
    expect((schema.source_id_format as string).toLowerCase()).toContain("gid");
  });

  it("proposed_schema.entity_subtypes includes task, project, and person", () => {
    // From listing.yaml lines 61-69: task, project, portfolio, person
    const schema = loadListing().proposed_schema as Record<string, unknown>;
    const subtypes = schema.entity_subtypes as Array<{ subtype: string }>;
    expect(Array.isArray(subtypes)).toBe(true);
    const subtypeNames = subtypes.map((s) => s.subtype);
    expect(subtypeNames).toContain("task");
    expect(subtypeNames).toContain("project");
    expect(subtypeNames).toContain("person");
  });

  it("proposed_schema.action_classes includes deadline and response-needed", () => {
    // From listing.yaml lines 70-78
    const schema = loadListing().proposed_schema as Record<string, unknown>;
    const classes = schema.action_classes as Array<{ class: string }>;
    expect(Array.isArray(classes)).toBe(true);
    const classNames = classes.map((c) => c.class);
    expect(classNames).toContain("deadline");
    expect(classNames).toContain("response-needed");
  });

  it("requires_source_mcp connector_slug is asana", () => {
    // From listing.yaml lines 50-52
    const req = loadListing().requires_source_mcp as Record<string, unknown>;
    expect(req.connector_slug).toBe("asana");
    expect(req.source).toBe("connector");
  });

  it("requires agntux-core in requires_plugins", () => {
    // From listing.yaml lines 47-48
    const plugins = loadListing().requires_plugins as string[];
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins).toContain("agntux-core");
  });
});

// ---------------------------------------------------------------------------
// skill prompt substitution — rendered SKILL.md
// The renderer populates skills/agntux-asana/SKILL.md during the build
// stage that runs before vitest in the gate.
// Tests skip gracefully when the rendered file is absent (local runs).
// Derived from: _overrides/frontmatter.yaml (placeholder key inventory),
//               canonical inline-skill template contract.
// Mechanical rule 4: grep the RENDERED file, never _overrides source.
// ---------------------------------------------------------------------------
describe("skill prompt substitution", () => {
  it("no unsubstituted {{...}} placeholders in the rendered sync skill", () => {
    if (!SKILL_EXISTS) return;
    const p = readFileSync(SKILL_PATH, "utf-8");
    const matches = p.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("rendered SKILL.md frontmatter is inline — no context:/agent:/tools: lines", () => {
    if (!SKILL_EXISTS) return;
    const p = readFileSync(SKILL_PATH, "utf-8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).toMatch(new RegExp(`^name: ${SLUG}$`, "m"));
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });

  it("no unsubstituted {{...}} placeholders in rendered reference files", () => {
    if (!SKILL_EXISTS) return;
    const refDir = join(PLUGIN_ROOT, `skills/${SLUG}/reference`);
    if (!existsSync(refDir)) return;
    const refs = readdirSync(refDir).filter((n) => n.endsWith(".md"));
    expect(refs.length).toBeGreaterThan(0);
    for (const name of refs) {
      const text = readFileSync(join(refDir, name), "utf-8");
      const matches = text.match(/\{\{[a-z-]+\}\}/g);
      expect(
        matches,
        `reference/${name} contains unsubstituted placeholder`,
      ).toBeNull();
    }
  });
});
