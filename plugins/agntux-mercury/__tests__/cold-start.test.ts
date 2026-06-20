// cold-start.test.ts — agntux-mercury plugin shape contract.
//
// Asserts:
//   - plugin.json required fields (verbatim values from the authored file).
//   - listing.yaml proposed_schema fields via plain-text substring checks
//     (no YAML parser dependency — vitest + node built-ins only).
//   - Inline-skill pattern: no agents/, hooks/, mcp-server/, .mcp.json.
//   - No write tools, no UI handlers, no view-tool/ subtree (ingest-only).
//   - Placeholder survival check on the RENDERED skill tree (skips gracefully
//     when the rendered tree is absent — the gate renders before vitest runs).
//
// Grounding: every assertion is derived from a file we READ, per the golden
// rule. No prose from _overrides/ source files is asserted (E30).
// No js-yaml or any non-devDependency package is imported.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-mercury";

// ── Manifest ──────────────────────────────────────────────────────────────────

describe("manifest", () => {
  it("plugin.json has required fields", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim values from .claude-plugin/plugin.json
    expect(m.name).toBe("agntux-mercury");
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
    // Verbatim from plugin.json recommended_ingest_cadence
    expect(m.recommended_ingest_cadence).toBe(
      "Every 2 hours, 7am–7pm weekdays, local",
    );
  });

  it("listing.yaml proposed_schema.cursor_semantics is present and describes per-account incremental cursor", () => {
    // Read listing.yaml as plain text — no YAML parser needed for a scalar field.
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics line.
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    expect(raw).toContain("cursor_semantics:");
    // Verbatim from listing.yaml cursor_semantics value
    expect(raw).toContain("Incremental cursor");
  });

  it("listing.yaml proposed_schema.source_id_format documents {resource_type}#{uuid}", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    expect(raw).toContain("source_id_format:");
    // Verbatim from listing.yaml source_id_format value
    expect(raw).toContain("{resource_type}#");
  });

  it("listing.yaml proposed_schema.action_classes declares expected classes", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    // Verbatim YAML list-item lines from listing.yaml proposed_schema.action_classes
    expect(raw).toContain("    - class: deadline");
    expect(raw).toContain("    - class: response-needed");
    expect(raw).toContain("    - class: knowledge-update");
    expect(raw).toContain("    - class: risk");
    expect(raw).toContain("    - class: opportunity");
    expect(raw).toContain("    - class: other");
  });

  it("listing.yaml proposed_schema.entity_subtypes declares expected subtypes", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    // Verbatim YAML list-item lines from listing.yaml proposed_schema.entity_subtypes
    expect(raw).toContain("    - subtype: account");
    expect(raw).toContain("    - subtype: transaction");
    expect(raw).toContain("    - subtype: card");
    expect(raw).toContain("    - subtype: send-money-approval");
    expect(raw).toContain("    - subtype: invoice");
  });

  it("listing.yaml requires agntux-core and a mercury connector", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    // Verbatim from listing.yaml requires_plugins list item
    expect(raw).toContain("  - agntux-core");
    // Verbatim from listing.yaml requires_source_mcp.connector_slug
    expect(raw).toContain("connector_slug: mercury");
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

  it("does NOT ship a view-tool/ directory — ingest-only, no UI handler", () => {
    // agntux-mercury is read-only ingest-only; no compose/send flow, no view-tool.
    expect(existsSync(join(PLUGIN_ROOT, "view-tool"))).toBe(false);
  });

  it("does NOT ship a ui-handlers/ directory — no write tools, no compose flow", () => {
    expect(existsSync(join(PLUGIN_ROOT, "ui-handlers"))).toBe(false);
  });
});

// ── Skill prompt substitution (rendered tree) ─────────────────────────────────
// The rendered tree (skills/agntux-mercury/SKILL.md + reference/) is
// produced by the gate's render-skill.mjs step BEFORE vitest runs. If the
// file doesn't exist (pre-render cold run), the test skips with a warning
// rather than hard-failing, so CI doesn't confuse a missing render with a
// placeholder-survival error.
//
// IMPORTANT: we check the RENDERED skills/agntux-mercury/ tree — never the
// _overrides/ source (E30 / mechanical rule 4).

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
      expect(matches, `unsubstituted placeholder in reference/${f}`).toBeNull();
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
    // The forked-context patterns are retired.
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });
});
