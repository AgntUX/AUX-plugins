/**
 * draft-flow.test.ts — Structural assertions for the two write-back UI
 * handlers (schedule + respond) in agntux-google-calendar.
 *
 * This plugin ships UI handlers (not the legacy chat-confirm flow), so the
 * assertions here are the structural-shape backstop per the
 * "connector-envelope.test.ts" pattern (named draft-flow per build convention).
 *
 * Assertion sources (E30-safe, per golden rule):
 *   2. parsed listing.yaml fields (js-yaml, mechanical rule 5):
 *        ui_components[*] (name / view_tool / resource_uri),
 *        proposed_schema.cursor_semantics,
 *        proposed_schema.source_id_format,
 *        proposed_schema.action_classes[*].class
 *   Structural existsSync checks on _overrides/reference/ files
 *   (file existence is a structural contract, not body prose — E30-safe).
 *
 * data/instructions/agntux-google-calendar.md body prose is NOT grepped
 * (E30 violation per agntux-build 0.27.0 gate extension to
 * data/instructions/<slug>.md). The action_classes facts it documented
 * are re-grounded in listing.yaml proposed_schema.action_classes instead.
 *
 * Every verbatim string comes from a file Read before authoring this test.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-google-calendar";

// ---------------------------------------------------------------------------
// listing.yaml — action_classes in proposed_schema
// Parsed via js-yaml (golden rule source 2). Replaces the removed
// data/instructions/agntux-google-calendar.md describe block.
// action_classes are the canonical write-back classes the draft flow acts on.
// ---------------------------------------------------------------------------

describe("listing.yaml proposed_schema action_classes", () => {
  async function parsedActionClasses(): Promise<string[]> {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    const listing = load(raw) as Record<string, unknown>;
    const schema = listing.proposed_schema as Record<string, unknown>;
    const classes = schema.action_classes as Array<Record<string, unknown>>;
    return classes.map((c) => c.class as string);
  }

  it("declares response-needed class", async () => {
    const classes = await parsedActionClasses();
    // Verbatim from listing.yaml proposed_schema.action_classes[].class
    expect(classes).toContain("response-needed");
  });

  it("declares meeting-prep class", async () => {
    const classes = await parsedActionClasses();
    // Verbatim from listing.yaml proposed_schema.action_classes[].class
    expect(classes).toContain("meeting-prep");
  });

  it("declares risk class", async () => {
    const classes = await parsedActionClasses();
    // Verbatim from listing.yaml proposed_schema.action_classes[].class
    expect(classes).toContain("risk");
  });

  it("declares knowledge-update class", async () => {
    const classes = await parsedActionClasses();
    // Verbatim from listing.yaml proposed_schema.action_classes[].class
    expect(classes).toContain("knowledge-update");
  });

  it("declares deadline class", async () => {
    const classes = await parsedActionClasses();
    // Verbatim from listing.yaml proposed_schema.action_classes[].class
    expect(classes).toContain("deadline");
  });

  it("declares other class (escape hatch)", async () => {
    const classes = await parsedActionClasses();
    // Verbatim from listing.yaml proposed_schema.action_classes[].class
    expect(classes).toContain("other");
  });
});

// ---------------------------------------------------------------------------
// Per-verb payload reference files — existence check only (not body prose)
// Rule 6 (E30) prohibits readFileSync(...reference/*.md).toContain(...).
// File existence is a structural contract: if schedule-payload.md is absent
// the view tool cannot read its envelope schema.
// ---------------------------------------------------------------------------

describe("per-verb payload reference files exist", () => {
  const REF = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides/reference`);

  it("_overrides/reference/schedule-payload.md exists", () => {
    expect(existsSync(join(REF, "schedule-payload.md"))).toBe(true);
  });

  it("_overrides/reference/respond-payload.md exists", () => {
    expect(existsSync(join(REF, "respond-payload.md"))).toBe(true);
  });

  it("_overrides/reference/compose-payload.md exists", () => {
    expect(existsSync(join(REF, "compose-payload.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listing.yaml — connector-targeted UI handler declarations
// Using parsed YAML (golden rule source 2); no text regex on field names.
// ---------------------------------------------------------------------------

describe("listing.yaml — handler routing URIs and view tool names", () => {
  async function parsedListing() {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    return load(raw) as Record<string, unknown>;
  }

  it("schedule handler resource_uri is ui://agntux-google-calendar/schedule", async () => {
    const listing = await parsedListing();
    const components = listing.ui_components as Array<Record<string, unknown>>;
    const schedule = components.find((c) => c.name === "schedule");
    // Verbatim from listing.yaml resource_uri field
    expect(schedule?.resource_uri).toBe("ui://agntux-google-calendar/schedule");
  });

  it("respond handler resource_uri is ui://agntux-google-calendar/respond", async () => {
    const listing = await parsedListing();
    const components = listing.ui_components as Array<Record<string, unknown>>;
    const respond = components.find((c) => c.name === "respond");
    // Verbatim from listing.yaml resource_uri field
    expect(respond?.resource_uri).toBe("ui://agntux-google-calendar/respond");
  });

  it("schedule view_tool name matches the connector-direct naming convention", async () => {
    const listing = await parsedListing();
    const components = listing.ui_components as Array<Record<string, unknown>>;
    const schedule = components.find((c) => c.name === "schedule");
    // Verbatim from listing.yaml: agntux_google_calendar_schedule_view
    expect(schedule?.view_tool).toBe("agntux_google_calendar_schedule_view");
  });

  it("respond view_tool name matches the connector-direct naming convention", async () => {
    const listing = await parsedListing();
    const components = listing.ui_components as Array<Record<string, unknown>>;
    const respond = components.find((c) => c.name === "respond");
    // Verbatim from listing.yaml: agntux_google_calendar_respond_view
    expect(respond?.view_tool).toBe("agntux_google_calendar_respond_view");
  });
});

// ---------------------------------------------------------------------------
// connector_intent keys in listing.yaml cursor_semantics (golden rule source 2)
// listing.yaml proposed_schema.cursor_semantics is a parsed-YAML field.
// ---------------------------------------------------------------------------

describe("listing.yaml cursor_semantics field", () => {
  it("declares the per-event cursor_semantics field in proposed_schema", async () => {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    const listing = load(raw) as Record<string, unknown>;
    const schema = listing.proposed_schema as Record<string, unknown> | undefined;
    // Parsed-YAML assertion: cursor_semantics is a non-empty string
    expect(typeof schema?.cursor_semantics).toBe("string");
    expect((schema?.cursor_semantics as string).length).toBeGreaterThan(0);
  });

  it("cursor_semantics describes the look_ahead_window_end key", async () => {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    const listing = load(raw) as Record<string, unknown>;
    const schema = listing.proposed_schema as Record<string, unknown>;
    const semantics = schema.cursor_semantics as string;
    // Verbatim from listing.yaml proposed_schema.cursor_semantics field value
    expect(semantics).toContain("look_ahead_window_end");
  });

  it("cursor_semantics describes the <calendar_id>#<event_id> per-event key format", async () => {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    const listing = load(raw) as Record<string, unknown>;
    const schema = listing.proposed_schema as Record<string, unknown>;
    const semantics = schema.cursor_semantics as string;
    // Verbatim from listing.yaml proposed_schema.cursor_semantics value
    expect(semantics).toContain("<calendar_id>#<event_id>");
  });
});

// ---------------------------------------------------------------------------
// connector_intent key in listing.yaml source_id_format (golden rule source 2)
// ---------------------------------------------------------------------------

describe("listing.yaml source_id_format", () => {
  it("declares the source_id_format for events", async () => {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    const listing = load(raw) as Record<string, unknown>;
    const schema = listing.proposed_schema as Record<string, unknown>;
    // Verbatim from listing.yaml proposed_schema.source_id_format value
    expect(schema.source_id_format as string).toContain("<calendar_id>#<event_id>");
  });
});
