// cold-start.test.ts — agntux-dropbox
//
// Asserts plugin shape against the inline-skill contract (post-7.0.0).
//
// Golden rule: every assertion is derived from files read directly —
// plugin.json and listing.yaml are parsed via JSON / js-yaml and assertions
// reference machine-readable fields. Filesystem shape checks use existsSync.
// No _overrides prose is grepped (E30 compliant).

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-dropbox";

// ---------------------------------------------------------------------------
// manifest
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

  it("plugin.json name matches SLUG exactly", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json: "name": "agntux-dropbox"
    expect(m.name).toBe("agntux-dropbox");
  });

  it("plugin.json version is 0.2.1", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json: "version": "0.2.1"
    expect(m.version).toBe("0.2.1");
  });

  it("recommended_ingest_cadence mentions weekdays", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim substring from plugin.json:
    // "Every 4 hours, 7am–7pm weekdays local"
    expect(m.recommended_ingest_cadence).toContain("weekdays");
  });

  it("recommended_ingest_cadence contains '4 hours'", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim substring from plugin.json: "Every 4 hours"
    expect(m.recommended_ingest_cadence).toContain("4 hours");
  });
});

// ---------------------------------------------------------------------------
// plugin shape (inline-skill pattern, post 6aa72b8)
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

  it("ships a view-tool/ directory", () => {
    expect(existsSync(join(PLUGIN_ROOT, "view-tool"))).toBe(true);
  });

  it("ships a .claude-plugin/plugin.json", () => {
    expect(existsSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"))).toBe(
      true,
    );
  });

  it("ships a marketplace/listing.yaml", () => {
    expect(existsSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// listing.yaml — parsed field assertions (mechanical rule 5)
// ---------------------------------------------------------------------------

describe("listing.yaml shape", () => {
  const listing = yaml.load(
    readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
  ) as Record<string, unknown>;

  it("has four ui_components", () => {
    const components = listing.ui_components as unknown[];
    // Derived from listing.yaml: ui_components has 4 entries:
    //   share-file, organize-file, new-folder, file-request
    expect(Array.isArray(components)).toBe(true);
    expect(components).toHaveLength(4);
  });

  it("ui_components names include share-file, organize-file, new-folder, file-request", () => {
    // Parsed from listing.yaml ui_components[].name
    const components = listing.ui_components as Array<Record<string, unknown>>;
    const names = components.map((c) => c.name as string);
    expect(names).toContain("share-file");
    expect(names).toContain("organize-file");
    expect(names).toContain("new-folder");
    expect(names).toContain("file-request");
  });

  it("proposed_schema.cursor_semantics is present and non-empty", () => {
    const schema = listing.proposed_schema as Record<string, unknown>;
    expect(typeof schema.cursor_semantics).toBe("string");
    expect((schema.cursor_semantics as string).length).toBeGreaterThan(0);
  });

  it("proposed_schema.source_id_format mentions file_id", () => {
    const schema = listing.proposed_schema as Record<string, unknown>;
    // Verbatim substring from listing.yaml proposed_schema.source_id_format:
    // "`{file_id}` — Dropbox's stable unique ID per file/folder"
    expect(schema.source_id_format as string).toContain("{file_id}");
  });

  it("proposed_schema has four entity_subtypes", () => {
    const schema = listing.proposed_schema as Record<string, unknown>;
    const subtypes = schema.entity_subtypes as Array<Record<string, unknown>>;
    // Parsed from listing.yaml: file, folder, shared-link, file-request
    expect(Array.isArray(subtypes)).toBe(true);
    expect(subtypes).toHaveLength(4);
  });

  it("entity_subtypes include file, folder, shared-link, file-request", () => {
    const schema = listing.proposed_schema as Record<string, unknown>;
    const subtypes = schema.entity_subtypes as Array<Record<string, unknown>>;
    const names = subtypes.map((s) => s.subtype as string);
    expect(names).toContain("file");
    expect(names).toContain("folder");
    expect(names).toContain("shared-link");
    expect(names).toContain("file-request");
  });

  it("proposed_schema.action_classes includes response-needed, knowledge-update, opportunity", () => {
    const schema = listing.proposed_schema as Record<string, unknown>;
    const classes = schema.action_classes as Array<Record<string, unknown>>;
    const classNames = classes.map((c) => c.class as string);
    // Verbatim from listing.yaml proposed_schema.action_classes
    expect(classNames).toContain("response-needed");
    expect(classNames).toContain("knowledge-update");
    expect(classNames).toContain("opportunity");
  });

  it("requires_source_mcp connector_slug is dropbox", () => {
    // Verbatim from listing.yaml: connector_slug: dropbox
    const req = listing.requires_source_mcp as Record<string, unknown>;
    expect(req.connector_slug).toBe("dropbox");
  });

  it("requires_plugins includes agntux-core", () => {
    const reqs = listing.requires_plugins as string[];
    expect(Array.isArray(reqs)).toBe(true);
    expect(reqs).toContain("agntux-core");
  });

  it("categories include productivity and notes-knowledge", () => {
    const categories = listing.categories as string[];
    // Verbatim from listing.yaml: categories: [productivity, notes-knowledge]
    expect(categories).toContain("productivity");
    expect(categories).toContain("notes-knowledge");
  });
});

// ---------------------------------------------------------------------------
// plugin.json + listing.yaml — plugin identity cross-check
// ---------------------------------------------------------------------------

describe("plugin identity cross-check (plugin.json + listing.yaml)", () => {
  it("plugin.json name is agntux-dropbox", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(m.name).toBe("agntux-dropbox");
  });

  it("listing.yaml connector_slug is dropbox (source-slug re-grounded)", () => {
    const listing = yaml.load(
      readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    const req = listing.requires_source_mcp as Record<string, unknown>;
    expect(req.connector_slug).toBe("dropbox");
  });
});

// ---------------------------------------------------------------------------
// skill overlay completeness — existsSync checks only (E30 compliant).
// Confirms the override files the renderer needs are present.
// ---------------------------------------------------------------------------

describe("skill overlay completeness", () => {
  it("_overrides directory exists", () => {
    expect(
      existsSync(join(PLUGIN_ROOT, `skills/${SLUG}/_overrides`)),
    ).toBe(true);
  });

  it("proposed_schema.cursor_semantics describes the folder_cursor component (frontmatter overlay applied)", () => {
    // Grounded in listing.yaml proposed_schema.cursor_semantics (machine-readable field, source #2).
    // Verbatim substring from listing.yaml:
    // "Four-part cursor: folder_cursor (server delta), files (file_id to rev map), ..."
    // This confirms the frontmatter overlay was applied and rendered into the listing.
    const listing = yaml.load(
      readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    const schema = listing.proposed_schema as Record<string, unknown>;
    expect(schema.cursor_semantics as string).toContain("folder_cursor");
  });

  it("rendered reference/cursor.md exists (four-part hybrid cursor override was rendered)", () => {
    // Grounded in the rendered output tree (skills/{slug}/reference/), not the
    // _overrides source. Asserting the rendered file confirms the override was
    // applied by the renderer. E30-compliant: no _overrides path literals.
    expect(
      existsSync(
        join(PLUGIN_ROOT, `skills/${SLUG}/reference/cursor.md`),
      ),
    ).toBe(true);
  });

  it("rendered reference/fetch.md exists (three-phase fetch override was rendered)", () => {
    // Same rationale: assert the renderer's output, not the source override.
    expect(
      existsSync(
        join(PLUGIN_ROOT, `skills/${SLUG}/reference/fetch.md`),
      ),
    ).toBe(true);
  });
});
