import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-google-drive";

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

describe("manifest", () => {
  it("plugin.json has required fields", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(m.name).toBe(SLUG);
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
  });

  it("plugin.json name matches slug exactly", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(m.name).toBe("agntux-google-drive");
  });
});

// ---------------------------------------------------------------------------
// Plugin shape (inline-skill pattern, post 6aa72b8)
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

  it("does NOT ship a view-tool/ directory — read-only source plugin has no UI handler", () => {
    expect(existsSync(join(PLUGIN_ROOT, "view-tool"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Skill prompt substitution (asserts the RENDERED tree, not _overrides)
// ---------------------------------------------------------------------------

describe("skill prompt substitution", () => {
  it("no unsubstituted {{...}} placeholders in the rendered sync skill", () => {
    const skillPath = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);
    const p = readFileSync(skillPath, "utf-8");
    const matches = p.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("rendered SKILL.md frontmatter runs INLINE — no context:/agent:/tools: lines", () => {
    const skillPath = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);
    const p = readFileSync(skillPath, "utf-8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).toMatch(new RegExp(`^name: ${SLUG}$`, "m"));
    // Forked-context patterns are retired; this test catches re-introduction
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });

  it("rendered reference/ directory contains expected files", () => {
    const refDir = join(PLUGIN_ROOT, `skills/${SLUG}/reference`);
    expect(existsSync(refDir)).toBe(true);
    for (const name of ["sync.md", "fetch.md", "cursor.md", "ask.md", "runbook.md"]) {
      expect(existsSync(join(refDir, name)), `reference/${name} is missing`).toBe(true);
    }
  });

  it("no unsubstituted {{...}} placeholders in any rendered reference file", () => {
    const refDir = join(PLUGIN_ROOT, `skills/${SLUG}/reference`);
    for (const name of readdirSync(refDir).filter((n) => n.endsWith(".md"))) {
      const body = readFileSync(join(refDir, name), "utf-8");
      const hits = body.match(/\{\{[a-z-]+\}\}/g);
      expect(hits, `{{placeholder}} found in reference/${name}`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// listing.yaml — text-based assertions (no js-yaml; verbatim substrings only)
// mechanical rule 5 exception: full YAML parse is not available without js-yaml;
// use verbatim substring checks derived by reading the actual file.
// ---------------------------------------------------------------------------

describe("listing.yaml proposed_schema", () => {
  const listingPath = join(PLUGIN_ROOT, "marketplace/listing.yaml");

  function listing(): string {
    return readFileSync(listingPath, "utf-8");
  }

  it("proposed_schema.entity_subtypes declares the six Drive file types", () => {
    const text = listing();
    // Verbatim subtype lines from marketplace/listing.yaml (4-space indent under entity_subtypes)
    expect(text).toContain("    - subtype: document");
    expect(text).toContain("    - subtype: spreadsheet");
    expect(text).toContain("    - subtype: presentation");
    expect(text).toContain("    - subtype: pdf");
    expect(text).toContain("    - subtype: folder");
    expect(text).toContain("    - subtype: other");
  });

  it("proposed_schema.action_classes is non-empty and contains knowledge-update and response-needed", () => {
    const text = listing();
    // Verbatim class lines from marketplace/listing.yaml (4-space indent under action_classes)
    expect(text).toContain("    - class: knowledge-update");
    expect(text).toContain("    - class: response-needed");
  });

  it("proposed_schema.cursor_semantics is present and non-empty", () => {
    // Verbatim key from marketplace/listing.yaml
    expect(listing()).toContain("  cursor_semantics:");
  });

  it("proposed_schema.source_id_format is present and non-empty", () => {
    // Verbatim key from marketplace/listing.yaml
    expect(listing()).toContain("  source_id_format:");
  });

  it("requires_source_mcp.connector_slug is google-drive", () => {
    // Verbatim line from marketplace/listing.yaml
    expect(listing()).toContain("  connector_slug: google-drive");
  });
});
