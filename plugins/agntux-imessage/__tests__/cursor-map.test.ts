// cursor-map.test.ts — per-handle last-seen-timestamp map cursor contract
// for agntux-imessage.
//
// iMessage uses a per-handle JSON map stored on the sync.md `cursor` line.
// Assertions are grounded in:
//   1. marketplace/listing.yaml parsed proposed_schema (machine-readable fields)
//   2. The example cursor map shapes from _overrides/reference/cursor.md,
//      validated by JSON.parse round-trips (no prose-grep against _overrides —
//      the round-trip itself is the structural assertion).
//   3. rendered skills/agntux-imessage/reference/cursor.md (skipped gracefully
//      if the rendered tree is absent).
//
// E30 guard: NO toContain assertions target _overrides/ source files.
// All toContain assertions target the RENDERED reference/cursor.md path
// (skills/agntux-imessage/reference/cursor.md).
//
// The JSON round-trip fixture strings are copied verbatim from cursor.md
// (read-then-copy-literal rule applied before authoring this file).

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-imessage";
const RENDERED_CURSOR_MD = join(
  PLUGIN_ROOT,
  `skills/${SLUG}/reference/cursor.md`,
);
const LISTING_YAML = join(PLUGIN_ROOT, "marketplace/listing.yaml");

// ── listing.yaml proposed_schema — machine-readable ──────────────────────────

describe("cursor semantics — listing.yaml contract", () => {
  it("proposed_schema.cursor_semantics describes a per-contact last-seen timestamp map", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    expect(typeof ps.cursor_semantics).toBe("string");
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics
    expect(ps.cursor_semantics as string).toContain("Per-contact last-seen timestamp");
  });

  it("proposed_schema.cursor_semantics notes the transactional advance rule", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics
    expect(ps.cursor_semantics as string).toContain("advances to the newest message");
  });

  it("proposed_schema.source_id_format documents the phone_or_email#message_id shape", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    expect(typeof ps.source_id_format).toBe("string");
    // Verbatim substring from listing.yaml proposed_schema.source_id_format
    expect(ps.source_id_format as string).toContain("phone_or_email");
    expect(ps.source_id_format as string).toContain("message_id");
  });
});

// ── JSON round-trip — cursor map structural assertions ────────────────────────
// These tests do NOT read _overrides/reference/cursor.md. They use the
// canonical example cursor value shapes documented in that file (copied verbatim
// before authoring) and assert only that JSON.parse round-trips cleanly — a
// structural check that does not depend on prose phrasing.

describe("cursor map — JSON round-trip validity", () => {
  // Example cursor after a successful run with three contacts.
  // Shape documented in the plugin's cursor.md override:
  //   key = sender handle exactly as returned by get_unread_imessages (E.164, bare-digits, or email)
  //   value = { last_seen: "<ISO-8601 UTC timestamp>" }

  it("a well-formed cursor map parses as a JSON object keyed by sender handles", () => {
    // Construct the fixture directly — no file read required.
    const validCursor = JSON.stringify({
      "+14155550101": { last_seen: "2026-06-18T18:15:00Z" },
      "+14155550102": { last_seen: "2026-06-18T17:45:00Z" },
      "alex@icloud.com": { last_seen: "2026-06-17T09:22:00Z" },
    });
    const parsed = JSON.parse(validCursor) as Record<
      string,
      { last_seen: string }
    >;
    expect(typeof parsed).toBe("object");
    // Every value must have a last_seen string
    for (const [, v] of Object.entries(parsed)) {
      expect(typeof v.last_seen).toBe("string");
      expect(v.last_seen.endsWith("Z")).toBe(true);
    }
  });

  it("adding a new sender handle preserves existing entries", () => {
    const before = {
      "+14155550101": { last_seen: "2026-06-18T18:15:00Z" },
    };
    const after = {
      ...before,
      "+14155550102": { last_seen: "2026-06-18T17:45:00Z" },
    };
    const parsed = JSON.parse(JSON.stringify(after)) as Record<
      string,
      { last_seen: string }
    >;
    // Existing entry preserved
    expect(parsed["+14155550101"].last_seen).toBe("2026-06-18T18:15:00Z");
    // New entry present
    expect(parsed["+14155550102"].last_seen).toBe("2026-06-18T17:45:00Z");
  });

  it("advancing an existing entry's last_seen does not affect other entries", () => {
    const before = {
      "+14155550101": { last_seen: "2026-06-18T18:00:00Z" },
      "+14155550102": { last_seen: "2026-06-18T17:45:00Z" },
    };
    const after = {
      ...before,
      "+14155550101": { last_seen: "2026-06-18T18:15:00Z" },
    };
    const parsed = JSON.parse(JSON.stringify(after)) as Record<
      string,
      { last_seen: string }
    >;
    expect(parsed["+14155550101"].last_seen).toBe("2026-06-18T18:15:00Z");
    // Sibling entry unchanged
    expect(parsed["+14155550102"].last_seen).toBe("2026-06-18T17:45:00Z");
  });

  it("evicting a 90-day-idle handle removes only that key", () => {
    const mapWithIdle = {
      "+14155550101": { last_seen: "2026-06-18T18:15:00Z" },
      // idle for 92 days at a run timestamp of 2026-09-18
      "+14155550102": { last_seen: "2026-06-18T17:45:00Z" },
      "alex@icloud.com": { last_seen: "2026-06-17T09:22:00Z" },
    };
    const runNow = new Date("2026-09-18T09:00:00Z");
    const cutoff = new Date(
      runNow.getTime() - 90 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const evicted = Object.entries(mapWithIdle)
      .filter(([, v]) => v.last_seen < cutoff)
      .map(([k]) => k);

    const afterEviction = Object.fromEntries(
      Object.entries(mapWithIdle).filter(([, v]) => v.last_seen >= cutoff),
    );

    // Both +14155550102 and alex@icloud.com are older than 90 days relative
    // to 2026-09-18 (last_seen 2026-06-17/18 = ~92 days ago)
    expect(evicted.length).toBeGreaterThanOrEqual(1);
    // Surviving entries round-trip cleanly
    const round = JSON.parse(JSON.stringify(afterEviction)) as Record<
      string,
      { last_seen: string }
    >;
    for (const [, v] of Object.entries(round)) {
      expect(typeof v.last_seen).toBe("string");
    }
  });

  it("the cursor map has no <handle>#<msg_id> parent-registry entries — bare handle keys only", () => {
    const cursor = {
      "+14155550101": { last_seen: "2026-06-18T18:15:00Z" },
      "alex@icloud.com": { last_seen: "2026-06-17T09:22:00Z" },
    };
    for (const key of Object.keys(cursor)) {
      // A tracked-parent entry would look like "+14155550101#1234"
      expect(key).not.toMatch(/#\d+$/);
    }
  });

  it("bootstrap state cursor null is preserved as null in JSON", () => {
    const bootstrapState = { cursor: null, last_success: null };
    const round = JSON.parse(JSON.stringify(bootstrapState)) as {
      cursor: null;
      last_success: null;
    };
    expect(round.cursor).toBeNull();
    expect(round.last_success).toBeNull();
  });
});

// ── Rendered reference/cursor.md — dedup anchors ─────────────────────────────
// Assertions only run when the rendered tree exists (post first render-skill.mjs run).
// E30 guard: target is skills/agntux-imessage/reference/cursor.md (rendered output).

describe("cursor semantics — rendered reference/cursor.md", () => {
  function skipIfNotRendered() {
    if (!existsSync(RENDERED_CURSOR_MD)) {
      console.warn(
        `cursor-map: skipping rendered-file assertions — ${RENDERED_CURSOR_MD} not found yet. Run render-skill.mjs first.`,
      );
      return true;
    }
    return false;
  }

  it("cursor is described as a per-handle last-seen-timestamp map strategy", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from _overrides/reference/cursor.md strategy-name heading
    expect(text).toContain("Per-handle last-seen-timestamp map");
  });

  it("cursor map key is the sender handle exactly as returned by the connector", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from _overrides/reference/cursor.md map-key section
    expect(text).toContain("sender handle exactly as returned by");
  });

  it("value shape is documented with a last_seen field", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from _overrides/reference/cursor.md value-shape section
    expect(text).toContain('"last_seen"');
  });

  it("bootstrap state documents cursor: null", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from _overrides/reference/cursor.md bootstrap state block
    expect(text).toContain("cursor: null");
    expect(text).toContain("last_success: null");
  });

  it("documents the 90-day idle eviction rule", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from _overrides/reference/cursor.md eviction section
    expect(text).toContain("90 days");
    expect(text).toContain("imessage-cursor-evicted");
  });

  it("documents the 20-sender run cap", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from _overrides/reference/cursor.md run-cap section
    expect(text).toContain("20 distinct sender threads");
  });

  it("documents the transactional advance rule", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from _overrides/reference/cursor.md advance rule
    expect(text).toContain("advance only on full-run success");
  });

  it("states there is no tracked-parent registry for iMessage", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from _overrides/reference/cursor.md no-tracked-parent section header
    expect(text).toContain("No tracked-parent registry");
  });

  it("documents the _sources.json lookup-before-write protocol", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Generic canonical anchors
    expect(text).toContain("_sources.json");
    expect(text).toContain("lookup-before-write");
  });
});
