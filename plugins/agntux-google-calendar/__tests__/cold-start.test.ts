/**
 * cold-start.test.ts — Plugin shape and manifest assertions for
 * agntux-google-calendar. Every toContain string is a verbatim substring
 * copied from the on-disk file. No LLM at test time; no phantom contracts.
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
    // Verbatim substring: "Daily 04:00" from plugin.json
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
// _overrides/frontmatter.yaml — key substitution values
// ---------------------------------------------------------------------------

describe("_overrides/frontmatter.yaml", () => {
  const fmPath = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides/frontmatter.yaml`);

  it("declares plugin-slug: agntux-google-calendar", () => {
    const fm = readFileSync(fmPath, "utf-8");
    // Verbatim line from frontmatter.yaml
    expect(fm).toContain("plugin-slug: agntux-google-calendar");
  });

  it("declares recommended-cadence with Daily at 04:00 local", () => {
    const fm = readFileSync(fmPath, "utf-8");
    // Verbatim substring from frontmatter.yaml: recommended-cadence: "Daily at 04:00 local"
    expect(fm).toContain("Daily at 04:00 local");
  });

  it("declares source-display-name: Google Calendar", () => {
    const fm = readFileSync(fmPath, "utf-8");
    // Verbatim from frontmatter.yaml
    expect(fm).toContain("source-display-name: Google Calendar");
  });

  it("declares source-mcp-tools including list_calendars and list_events", () => {
    const fm = readFileSync(fmPath, "utf-8");
    // Verbatim from frontmatter.yaml: source-mcp-tools: "list_calendars, list_events, get_event"
    expect(fm).toContain("list_calendars");
    expect(fm).toContain("list_events");
  });
});

// ---------------------------------------------------------------------------
// _overrides/reference/fetch.md — list_calendars → per-calendar list_events flow
// ---------------------------------------------------------------------------

describe("_overrides/reference/fetch.md — fetch flow", () => {
  const fetchPath = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides/reference/fetch.md`);

  it("documents the list_calendars call in Step 5a", () => {
    const doc = readFileSync(fetchPath, "utf-8");
    // Verbatim from fetch.md §Step 5a: mcp__claude_ai_GoogleCalendar__list_calendars()
    expect(doc).toContain("mcp__claude_ai_GoogleCalendar__list_calendars()");
  });

  it("documents per-calendar list_events in Step 5b", () => {
    const doc = readFileSync(fetchPath, "utf-8");
    // Verbatim from fetch.md §Step 5b
    expect(doc).toContain("mcp__claude_ai_GoogleCalendar__list_events(");
  });

  it("documents the 80-event volume cap", () => {
    const doc = readFileSync(fetchPath, "utf-8");
    // Verbatim from fetch.md line 16 (single-line substring; sentence wraps at line boundary).
    expect(doc).toContain("The 80-event volume cap applies across all calendars");
  });

  it("documents the singleEvents = true parameter requirement", () => {
    const doc = readFileSync(fetchPath, "utf-8");
    // Verbatim from fetch.md §Step 5b parameter list: singleEvents    = true
    expect(doc).toContain("singleEvents    = true");
  });

  it("documents writable vs read-only calendar partitioning", () => {
    const doc = readFileSync(fetchPath, "utf-8");
    // Verbatim from fetch.md §Step 5a partition list items
    expect(doc).toContain("**Writable**");
    expect(doc).toContain("**Read-only**");
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
