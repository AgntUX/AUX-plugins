/**
 * cold-start.test.ts — agntux-zoom
 *
 * Asserts plugin shape: manifest correctness, inline-skill pattern (no
 * retired directories, no retired frontmatter keys), listing.yaml structure
 * via parsed YAML, and placeholder-survival guard on the rendered SKILL.md
 * (skipped gracefully when the render step has not yet run).
 *
 * GOLDEN RULE: every assertion is grounded in:
 *   1. The handler's actual output (payload-shape.test.ts), or
 *   2. A machine-readable field in plugin.json / listing.yaml (parsed YAML), or
 *   3. A verbatim substring copied from the authored file after reading it.
 * No prose-grep on _overrides/** or data/instructions/**  (E30 rule).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-zoom";

// ---------------------------------------------------------------------------
// Manifest — plugin.json
// ---------------------------------------------------------------------------
describe("manifest", () => {
  it("plugin.json has required fields with correct types", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(m.name).toBe(SLUG);
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
  });

  it("plugin.json recommended_ingest_cadence matches the authored value", () => {
    // Verbatim from .claude-plugin/plugin.json line 7.
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(m.recommended_ingest_cadence).toBe("Every 30 min, 7am–7pm weekdays local");
  });

  it("plugin.json license is Apache-2.0", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(m.license).toBe("Apache-2.0");
  });

  it("plugin.json description is a non-empty string", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(typeof m.description).toBe("string");
    expect(m.description.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Plugin shape (inline-skill pattern, post 6aa72b8)
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
});

// ---------------------------------------------------------------------------
// listing.yaml — machine-readable assertions (parsed YAML, never text-regex)
// ---------------------------------------------------------------------------
describe("listing.yaml", () => {
  let listing: Record<string, unknown>;

  function loadListing() {
    if (listing) return listing;
    listing = yaml.load(
      readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    return listing;
  }

  it("has a tagline string", () => {
    const l = loadListing();
    expect(typeof l.tagline).toBe("string");
    expect((l.tagline as string).length).toBeGreaterThan(0);
  });

  it("categories include productivity", () => {
    const l = loadListing();
    expect(l.categories).toContain("productivity");
  });

  it("requires_source_mcp connector_slug is zoom", () => {
    const l = loadListing();
    const rsm = l.requires_source_mcp as Record<string, unknown>;
    expect(rsm.connector_slug).toBe("zoom");
  });

  it("ships exactly 1 ui_component", () => {
    const l = loadListing();
    expect(Array.isArray(l.ui_components)).toBe(true);
    expect((l.ui_components as unknown[]).length).toBe(1);
  });

  it("ui_component view_tool is agntux_zoom_save_doc_view", () => {
    const l = loadListing();
    const components = l.ui_components as Array<Record<string, unknown>>;
    const viewTools = components.map((c) => c.view_tool);
    expect(viewTools).toContain("agntux_zoom_save_doc_view");
  });

  it("ui_component name is save-doc", () => {
    const l = loadListing();
    const components = l.ui_components as Array<Record<string, unknown>>;
    const names = components.map((c) => c.name);
    expect(names).toContain("save-doc");
  });

  it("ui_component resource_uri is ui://agntux-zoom/save-doc", () => {
    const l = loadListing();
    const components = l.ui_components as Array<Record<string, unknown>>;
    const uris = components.map((c) => c.resource_uri);
    expect(uris).toContain("ui://agntux-zoom/save-doc");
  });

  it("proposed_schema has 4 entity_subtypes", () => {
    const l = loadListing();
    const ps = l.proposed_schema as Record<string, unknown>;
    const subtypes = ps.entity_subtypes as unknown[];
    expect(Array.isArray(subtypes)).toBe(true);
    expect(subtypes.length).toBe(4);
  });

  it("proposed_schema entity_subtypes include meeting, chat-thread, document, person", () => {
    const l = loadListing();
    const ps = l.proposed_schema as Record<string, unknown>;
    const subtypeNames = (ps.entity_subtypes as Array<Record<string, unknown>>).map(
      (s) => s.subtype,
    );
    expect(subtypeNames).toContain("meeting");
    expect(subtypeNames).toContain("chat-thread");
    expect(subtypeNames).toContain("document");
    expect(subtypeNames).toContain("person");
  });

  it("proposed_schema action_classes include deadline, response-needed, knowledge-update, risk, opportunity, other", () => {
    const l = loadListing();
    const ps = l.proposed_schema as Record<string, unknown>;
    const classes = (ps.action_classes as Array<Record<string, unknown>>).map(
      (c) => c.class,
    );
    expect(classes).toContain("deadline");
    expect(classes).toContain("response-needed");
    expect(classes).toContain("knowledge-update");
    expect(classes).toContain("risk");
    expect(classes).toContain("opportunity");
    expect(classes).toContain("other");
  });

  it("proposed_schema cursor_semantics is a non-empty string", () => {
    const l = loadListing();
    const ps = l.proposed_schema as Record<string, unknown>;
    expect(typeof ps.cursor_semantics).toBe("string");
    expect((ps.cursor_semantics as string).length).toBeGreaterThan(0);
  });

  it("proposed_schema cursor_semantics documents both cursor keys", () => {
    const l = loadListing();
    const ps = l.proposed_schema as Record<string, unknown>;
    const cs = ps.cursor_semantics as string;
    // Verbatim substrings from listing.yaml line 157 — the cursor_semantics field.
    expect(cs).toContain("meetings_since");
    expect(cs).toContain("chat_since");
  });

  it("proposed_schema source_id_format is a non-empty string", () => {
    const l = loadListing();
    const ps = l.proposed_schema as Record<string, unknown>;
    expect(typeof ps.source_id_format).toBe("string");
    expect((ps.source_id_format as string).length).toBeGreaterThan(0);
  });

  it("proposed_schema source_id_format documents zoom:meeting and zoom:recording namespaces", () => {
    const l = loadListing();
    const ps = l.proposed_schema as Record<string, unknown>;
    const sif = ps.source_id_format as string;
    // Verbatim substrings from listing.yaml line 158.
    expect(sif).toContain("zoom:meeting:");
    expect(sif).toContain("zoom:recording:");
  });
});

// ---------------------------------------------------------------------------
// Skill prompt substitution — rendered SKILL.md
// Only runs when the render step has produced the file. If the file is absent
// the test is skipped; the gate's render stage is responsible for producing it.
// ---------------------------------------------------------------------------
describe("skill prompt substitution", () => {
  const SKILL_PATH = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);
  const SKILL_EXISTS = existsSync(SKILL_PATH);

  it("no unsubstituted {{...}} placeholders in the rendered sync skill", () => {
    if (!SKILL_EXISTS) return; // rendered tree not yet present — gate handles this
    const p = readFileSync(SKILL_PATH, "utf-8");
    const matches = p.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("rendered SKILL.md frontmatter runs INLINE — no context:/agent:/tools: lines", () => {
    if (!SKILL_EXISTS) return;
    const p = readFileSync(SKILL_PATH, "utf-8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).toMatch(new RegExp(`^name: ${SLUG}$`, "m"));
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });
});
