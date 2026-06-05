/**
 * cold-start.test.ts — Plugin shape and manifest assertions for
 * agntux-google-calendar. Assertion sources (E30-safe, per golden rule):
 *   1. parsed plugin.json fields
 *   2. parsed listing.yaml fields (js-yaml, per mechanical rule 5)
 *   3. existsSync shape checks (structural contract, not body prose)
 *   4. rendered SKILL.md (canonical template output — not _overrides/)
 *
 * _overrides/frontmatter.yaml and _overrides/reference/fetch.md body
 * prose is NOT grepped (E30 violation per agntux-build 0.27.0 gate).
 * requires_source_mcp and requires_plugins facts are asserted via
 * parsed listing.yaml fields instead.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-google-calendar";

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

describe("manifest", () => {
  it("plugin.json has required fields", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json
    expect(m.name).toBe("agntux-google-calendar");
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
    // Verbatim substring: "Daily 04:00" from plugin.json recommended_ingest_cadence
    expect(m.recommended_ingest_cadence).toContain("04:00");
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
});

// ---------------------------------------------------------------------------
// listing.yaml — two ui_components (schedule + respond)
// Parsed via js-yaml per mechanical rule 5; never a text regex on field names.
// ---------------------------------------------------------------------------

describe("listing.yaml ui_components", () => {
  it("declares exactly two ui_components", async () => {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    const listing = load(raw) as Record<string, unknown>;
    const components = listing.ui_components as unknown[];
    expect(Array.isArray(components)).toBe(true);
    expect(components).toHaveLength(2);
  });

  it("schedule component names its view_tool agntux_google_calendar_schedule_view", async () => {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    const listing = load(raw) as Record<string, unknown>;
    const components = listing.ui_components as Array<Record<string, unknown>>;
    const schedule = components.find((c) => c.name === "schedule");
    expect(schedule).toBeDefined();
    // Verbatim from listing.yaml view_tool field: agntux_google_calendar_schedule_view
    expect(schedule?.view_tool).toBe("agntux_google_calendar_schedule_view");
  });

  it("respond component names its view_tool agntux_google_calendar_respond_view", async () => {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    const listing = load(raw) as Record<string, unknown>;
    const components = listing.ui_components as Array<Record<string, unknown>>;
    const respond = components.find((c) => c.name === "respond");
    expect(respond).toBeDefined();
    // Verbatim from listing.yaml view_tool field: agntux_google_calendar_respond_view
    expect(respond?.view_tool).toBe("agntux_google_calendar_respond_view");
  });

  it("schedule component declares the correct resource_uri", async () => {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    const listing = load(raw) as Record<string, unknown>;
    const components = listing.ui_components as Array<Record<string, unknown>>;
    const schedule = components.find((c) => c.name === "schedule");
    // Verbatim from listing.yaml: "ui://agntux-google-calendar/schedule"
    expect(schedule?.resource_uri).toBe("ui://agntux-google-calendar/schedule");
  });

  it("respond component declares the correct resource_uri", async () => {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    const listing = load(raw) as Record<string, unknown>;
    const components = listing.ui_components as Array<Record<string, unknown>>;
    const respond = components.find((c) => c.name === "respond");
    // Verbatim from listing.yaml: "ui://agntux-google-calendar/respond"
    expect(respond?.resource_uri).toBe("ui://agntux-google-calendar/respond");
  });
});

// ---------------------------------------------------------------------------
// listing.yaml — requires_source_mcp and requires_plugins
// Parsed via js-yaml (golden rule source 2). Replaces the removed
// _overrides/frontmatter.yaml and _overrides/reference/fetch.md describe
// blocks; all connector identity facts live verbatim in listing.yaml.
// ---------------------------------------------------------------------------

describe("listing.yaml requires_source_mcp", () => {
  async function parsedListing() {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    return load(raw) as Record<string, unknown>;
  }

  it("connector_slug is google-calendar", async () => {
    const listing = await parsedListing();
    const rsmcp = listing.requires_source_mcp as Record<string, unknown>;
    // Verbatim from listing.yaml requires_source_mcp.connector_slug
    expect(rsmcp.connector_slug).toBe("google-calendar");
  });

  it("display_name is Google Calendar", async () => {
    const listing = await parsedListing();
    const rsmcp = listing.requires_source_mcp as Record<string, unknown>;
    // Verbatim from listing.yaml requires_source_mcp.display_name
    expect(rsmcp.display_name).toBe("Google Calendar");
  });

  it("source field is connector", async () => {
    const listing = await parsedListing();
    const rsmcp = listing.requires_source_mcp as Record<string, unknown>;
    // Verbatim from listing.yaml requires_source_mcp.source
    expect(rsmcp.source).toBe("connector");
  });
});

describe("listing.yaml requires_plugins", () => {
  it("requires agntux-core (the _sources.json lookup contract owner)", async () => {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    const listing = load(raw) as Record<string, unknown>;
    const plugins = listing.requires_plugins as string[];
    expect(Array.isArray(plugins)).toBe(true);
    // Verbatim from listing.yaml requires_plugins list
    expect(plugins).toContain("agntux-core");
  });
});

// ---------------------------------------------------------------------------
// Rendered SKILL.md (only when present — render step runs during build)
// ---------------------------------------------------------------------------

describe("skill prompt substitution (rendered SKILL.md)", () => {
  const skillPath = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);

  it("no unsubstituted {{...}} placeholders in the rendered sync skill", () => {
    if (!existsSync(skillPath)) {
      // Rendered file not yet present (pre-build). Test is a no-op here.
      return;
    }
    const p = readFileSync(skillPath, "utf-8");
    // Per canonical rubric: grep only the rendered SKILL.md, not _overrides/
    const matches = p.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("rendered SKILL.md frontmatter has name: agntux-google-calendar and no context:/agent:/tools: lines", () => {
    if (!existsSync(skillPath)) {
      return;
    }
    const p = readFileSync(skillPath, "utf-8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).toMatch(/^name: agntux-google-calendar$/m);
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });
});
