/**
 * cold-start.test.ts — agntux-canva
 *
 * Contract-shape validation for the agntux-canva plugin.
 * Every assertion is derived from files read at authoring time.
 * Source files are noted inline for each assertion.
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
const SLUG = "agntux-canva";
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
    // recommended_ingest_cadence from plugin.json line 10
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
  });

  it("plugin.json cadence value matches authored string", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json line 10
    expect(m.recommended_ingest_cadence).toBe(
      "Every 60 min, 7am–7pm weekdays local",
    );
  });

  it("plugin.json license is Apache-2.0", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json line 9
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

  it("ships a view-tool/ directory (UI-bearing plugin with three handlers)", () => {
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

  it("declares exactly 3 ui_components", () => {
    // ui_components from listing.yaml lines 32-47: reply, comment, export
    const components = loadListing().ui_components as unknown[];
    expect(Array.isArray(components)).toBe(true);
    expect(components).toHaveLength(3);
  });

  it("ui_component names include reply, comment, and export", () => {
    // From listing.yaml lines 33, 39, 44
    const components = loadListing().ui_components as Array<{ name: string }>;
    const names = components.map((c) => c.name);
    expect(names).toContain("reply");
    expect(names).toContain("comment");
    expect(names).toContain("export");
  });

  it("ui_component view_tool names are the three canonical tool identifiers", () => {
    // From listing.yaml view_tool fields: agntux_canva_reply, agntux_canva_comment, agntux_canva_export
    const components = loadListing().ui_components as Array<{
      name: string;
      view_tool: string;
    }>;
    const toolNames = components.map((c) => c.view_tool);
    expect(toolNames).toContain("agntux_canva_reply");
    expect(toolNames).toContain("agntux_canva_comment");
    expect(toolNames).toContain("agntux_canva_export");
  });

  it("proposed_schema.cursor_semantics is a non-empty string", () => {
    // From listing.yaml line 93
    const schema = loadListing().proposed_schema as Record<string, unknown>;
    expect(typeof schema.cursor_semantics).toBe("string");
    expect((schema.cursor_semantics as string).length).toBeGreaterThan(0);
  });

  it("proposed_schema.source_id_format mentions design_id and comment_id", () => {
    // Verbatim from listing.yaml line 94:
    // "`{design_id}#{comment_id}` — design IDs start with D (11 chars total)"
    const schema = loadListing().proposed_schema as Record<string, unknown>;
    expect(typeof schema.source_id_format).toBe("string");
    const fmt = schema.source_id_format as string;
    expect(fmt).toContain("design_id");
    expect(fmt).toContain("comment_id");
  });

  it("proposed_schema.entity_subtypes includes design and comment", () => {
    // From listing.yaml lines 59-85: design, comment
    const schema = loadListing().proposed_schema as Record<string, unknown>;
    const subtypes = schema.entity_subtypes as Array<{ subtype: string }>;
    expect(Array.isArray(subtypes)).toBe(true);
    const subtypeNames = subtypes.map((s) => s.subtype);
    expect(subtypeNames).toContain("design");
    expect(subtypeNames).toContain("comment");
  });

  it("proposed_schema.action_classes includes response-needed and knowledge-update", () => {
    // From listing.yaml lines 86-95
    const schema = loadListing().proposed_schema as Record<string, unknown>;
    const classes = schema.action_classes as Array<{ class: string }>;
    expect(Array.isArray(classes)).toBe(true);
    const classNames = classes.map((c) => c.class);
    expect(classNames).toContain("response-needed");
    expect(classNames).toContain("knowledge-update");
  });

  it("requires_source_mcp connector_slug is canva", () => {
    // From listing.yaml lines 28-31
    const req = loadListing().requires_source_mcp as Record<string, unknown>;
    expect(req.connector_slug).toBe("canva");
    expect(req.source).toBe("connector");
  });

  it("requires agntux-core in requires_plugins", () => {
    // From listing.yaml lines 26-27
    const plugins = loadListing().requires_plugins as string[];
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins).toContain("agntux-core");
  });
});

// ---------------------------------------------------------------------------
// skill prompt substitution — rendered SKILL.md
// The renderer populates skills/agntux-canva/SKILL.md during the build
// stage that runs before vitest in the gate.
// Tests skip gracefully when the rendered file is absent (local runs).
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
