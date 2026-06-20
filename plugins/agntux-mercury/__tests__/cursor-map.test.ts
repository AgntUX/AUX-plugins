// cursor-map.test.ts — per-account JSON cursor contract for agntux-mercury.
//
// Mercury uses a compound cursor strategy: a per-account JSON map keyed by
// Mercury accountId UUID, where each value is an object with a `created_at`
// low-water-mark timestamp and a `pending_ids` re-poll set. This strategy is
// documented in the rendered reference/cursor.md (a wholesale override).
//
// Assertions are grounded in:
//   1. listing.yaml — read as plain text, verbatim substring checks.
//      (No YAML parser dependency — vitest + node built-ins only.)
//   2. The RENDERED skills/agntux-mercury/reference/cursor.md — verbatim
//      substrings copied from the file after reading it (read-then-copy-literal).
//
// E30 guard: ZERO assertions target _overrides/reference/cursor.md or any
// other _overrides/ source file. The rendered path is asserted instead.
//
// When the rendered tree does not exist (pre-render cold run), rendered-file
// assertions skip with a console.warn rather than hard-failing. The gate
// always renders before vitest, so skips should not appear in gate output.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-mercury";
const RENDERED_CURSOR_MD = join(
  PLUGIN_ROOT,
  `skills/${SLUG}/reference/cursor.md`,
);
const LISTING_YAML = join(PLUGIN_ROOT, "marketplace/listing.yaml");

// ── listing.yaml plain-text checks ───────────────────────────────────────────

describe("cursor semantics — listing.yaml contract", () => {
  it("proposed_schema.cursor_semantics describes incremental per-account cursor", () => {
    // Read listing.yaml as plain text — no YAML parser needed.
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics line.
    const raw = readFileSync(LISTING_YAML, "utf-8");
    expect(raw).toContain("cursor_semantics:");
    // Verbatim from listing.yaml cursor_semantics value
    expect(raw).toContain("Incremental cursor");
  });

  it("proposed_schema.cursor_semantics mentions createdAt as the advance field", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics
    expect(raw).toContain("createdAt");
  });

  it("proposed_schema.source_id_format documents {resource_type}#uuid pattern", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    expect(raw).toContain("source_id_format:");
    // Verbatim substring from listing.yaml proposed_schema.source_id_format
    expect(raw).toContain("{resource_type}#");
  });
});

// ── rendered reference/cursor.md ─────────────────────────────────────────────

describe("cursor semantics — rendered reference/cursor.md", () => {
  function skipIfNotRendered(): boolean {
    if (!existsSync(RENDERED_CURSOR_MD)) {
      console.warn(
        `cursor-map: skipping rendered-file assertions — ${RENDERED_CURSOR_MD} not found yet. Run render-skill.mjs first.`,
      );
      return true;
    }
    return false;
  }

  it("strategy name is the per-account createdAt low-water-mark map with pending-id re-poll set", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md strategy name heading
    expect(text).toContain(
      "Per-account createdAt low-water-mark map with pending-id re-poll set",
    );
  });

  it("cursor is described as a JSON object, not a scalar", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md: "The cursor value is a **JSON object**"
    expect(text).toContain("The cursor value is a");
    expect(text).toContain("JSON object");
  });

  it("map key is the Mercury accountId UUID exactly as returned by getAccounts", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md Map key section
    expect(text).toContain(
      "The key is the Mercury `accountId` UUID **exactly as returned by",
    );
  });

  it("value shape documents created_at and pending_ids as the two cursor value fields", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md value shape section — both fields appear in the JSON block
    expect(text).toContain('"created_at"');
    expect(text).toContain('"pending_ids"');
    // Verbatim from cursor.md: both fields are described by bold anchors
    expect(text).toContain("**`created_at`**");
    expect(text).toContain("**`pending_ids`**");
  });

  it("cursor shape example shows acct-uuid-checking and acct-uuid-savings", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md Cursor shape code block
    expect(text).toContain("acct-uuid-checking");
    expect(text).toContain("acct-uuid-savings");
  });

  it("bootstrap state documents cursor: null and last_success: null", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md Bootstrap state section
    expect(text).toContain("cursor: null");
    expect(text).toContain("last_success: null");
  });

  it("pending_ids re-poll step is documented per account before the main incremental page", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md section header
    expect(text).toContain("Pending-id re-poll step (Step 5b preamble)");
  });

  it("pending-id eviction at 30 days is documented", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md Pending-id eviction section heading
    expect(text).toContain("Pending-id eviction (stale-pending cleanup)");
    // Verbatim from cursor.md: "more than 30 days"
    expect(text).toContain("more than 30 days");
  });

  it("pending eviction logs mercury-pending-evicted error kind", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md Pending-id eviction section
    expect(text).toContain("mercury-pending-evicted");
  });

  it("pending not-found logs mercury-pending-not-found error kind", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md re-poll step: getTransactionById returns not-found
    expect(text).toContain("mercury-pending-not-found");
  });

  it("account eviction section documents mercury-cursor-evicted error kind", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md Account eviction section
    expect(text).toContain("Account eviction (account closed)");
    expect(text).toContain("mercury-cursor-evicted");
  });

  it("full-run success gate (transactional rule) is documented", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md section header
    expect(text).toContain("Full-run success gate (transactional rule)");
  });

  it("no tracked-parent registry section is present and explicitly forbids account#transaction key shape", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md No tracked-parent registry section
    expect(text).toContain("No tracked-parent registry");
    // Verbatim from cursor.md: key space must not have accountId#transactionId entries.
    // The phrase spans a line break in the source — assert the two parts separately.
    expect(text).toContain("contains only bare `<accountId>` entries");
    expect(text).toContain("`<accountId>#<transactionId>` entries");
  });

  it("cursor JSON round-trips for the example after-run fixture in cursor.md", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Extract the first JSON object from a cursor: '...' line in the rendered file.
    // This is the example fixture embedded in the Cursor shape section.
    const match = text.match(/cursor: '(\{[^']+\})'/);
    expect(match).not.toBeNull();
    const jsonStr = match![1];
    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(jsonStr);
    }).not.toThrow();
    // The parsed map must be a non-null object
    expect(typeof parsed).toBe("object");
    expect(parsed).not.toBeNull();
    // Each value must have created_at and pending_ids
    for (const [, val] of Object.entries(
      parsed as Record<string, Record<string, unknown>>,
    )) {
      expect(typeof val.created_at).toBe("string");
      // created_at must be an ISO-8601 UTC timestamp
      expect(val.created_at as string).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      );
      expect(Array.isArray(val.pending_ids)).toBe(true);
    }
  });

  it("adding a new account to the map preserves existing entries (structural invariant)", () => {
    // In-memory structural assertion: simulates what the advance rule requires.
    // A cursor with one existing account; after adding a second, the first must
    // be preserved unchanged.
    const existingCursor: Record<
      string,
      { created_at: string; pending_ids: unknown[] }
    > = {
      "acct-uuid-checking": {
        created_at: "2026-06-19T14:00:00Z",
        pending_ids: [{ id: "txn-uuid-a", since: "2026-06-19T14:05:00Z" }],
      },
    };

    // Simulate adding a new account (acct-uuid-savings) without touching the
    // existing entry — this is the correct cursor advance rule.
    const updatedCursor = {
      ...existingCursor,
      "acct-uuid-savings": {
        created_at: "2026-06-19T11:30:00Z",
        pending_ids: [] as unknown[],
      },
    };

    // Existing entry must be preserved byte-for-byte
    expect(updatedCursor["acct-uuid-checking"]).toStrictEqual(
      existingCursor["acct-uuid-checking"],
    );
    expect(updatedCursor["acct-uuid-savings"]).toBeDefined();

    // The map must round-trip through JSON
    const serialised = JSON.stringify(updatedCursor);
    const reparsed = JSON.parse(serialised) as typeof updatedCursor;
    expect(reparsed["acct-uuid-checking"].created_at).toBe(
      "2026-06-19T14:00:00Z",
    );
    expect(reparsed["acct-uuid-savings"].pending_ids).toHaveLength(0);
  });

  it("evicting a closed account removes its key without touching other entries", () => {
    // Structural assertion: account eviction must be a map-key delete,
    // not a full map replace.
    const cursor: Record<
      string,
      { created_at: string; pending_ids: unknown[] }
    > = {
      "acct-uuid-checking": {
        created_at: "2026-07-19T10:00:00Z",
        pending_ids: [],
      },
      "acct-uuid-savings": {
        created_at: "2026-06-19T11:30:00Z",
        pending_ids: [],
      },
    };

    // Simulate account closure: acct-uuid-savings absent from getAccounts.
    const liveAccountIds = new Set(["acct-uuid-checking"]);
    const evicted: string[] = [];
    for (const accountId of Object.keys(cursor)) {
      if (!liveAccountIds.has(accountId)) {
        evicted.push(accountId);
        delete cursor[accountId];
      }
    }

    expect(evicted).toEqual(["acct-uuid-savings"]);
    expect(Object.keys(cursor)).toEqual(["acct-uuid-checking"]);
    expect(cursor["acct-uuid-checking"].created_at).toBe(
      "2026-07-19T10:00:00Z",
    );
  });

  it("stale pending_ids eviction removes entries older than 30 days", () => {
    // Structural assertion: pending-id eviction is based on the `since` field
    // being more than 30 days before now. Extended object form documented in
    // cursor.md.
    const now = new Date("2026-07-19T10:03:11Z");
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    const pendingIds: Array<{ id: string; since: string }> = [
      { id: "txn-uuid-c", since: "2026-06-19T16:22:00Z" }, // 29.7 days before now — stale
      { id: "txn-uuid-d", since: "2026-07-18T09:00:00Z" }, // ~1 day before now — fresh
    ];

    const staleEntries = pendingIds.filter(
      (entry) =>
        now.getTime() - new Date(entry.since).getTime() > thirtyDaysMs,
    );
    const freshEntries = pendingIds.filter(
      (entry) =>
        now.getTime() - new Date(entry.since).getTime() <= thirtyDaysMs,
    );

    // txn-uuid-c: since 2026-06-19, now 2026-07-19 = 29.75 days > 30? No.
    // Let us recalculate: 2026-07-19 minus 2026-06-19 = 30 days exactly.
    // "more than 30 days" means strictly greater than. 30 days exactly is NOT stale.
    // So txn-uuid-c's since is exactly 30 days before; only entries *strictly* over 30 days evict.
    // Both entries should survive. Adjust: use a clearly-stale since value.
    const pendingIds2: Array<{ id: string; since: string }> = [
      { id: "txn-uuid-x", since: "2026-06-01T10:00:00Z" }, // 48 days before now — stale
      { id: "txn-uuid-y", since: "2026-07-18T09:00:00Z" }, // ~1 day before now — fresh
    ];

    const stale2 = pendingIds2.filter(
      (entry) =>
        now.getTime() - new Date(entry.since).getTime() > thirtyDaysMs,
    );
    const fresh2 = pendingIds2.filter(
      (entry) =>
        now.getTime() - new Date(entry.since).getTime() <= thirtyDaysMs,
    );

    expect(stale2.map((e) => e.id)).toContain("txn-uuid-x");
    expect(fresh2.map((e) => e.id)).toContain("txn-uuid-y");
    expect(stale2).toHaveLength(1);
    expect(fresh2).toHaveLength(1);

    // staleEntries from the first set: since exactly 30 days is not stale per "more than 30"
    expect(staleEntries).toHaveLength(0);
    expect(freshEntries).toHaveLength(2);
  });

  it("_sources.json lookup-before-write protocol is documented in cursor.md", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md _sources.json lookup-before-write section
    expect(text).toContain("_sources.json");
    expect(text).toContain("lookup-before-write");
  });

  it("documents that relatedTransactions are references, not a parent-reply registry", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md No tracked-parent registry section (line-exact copy)
    expect(text).toContain(
      "this is a **reference relationship**, not a parent-reply",
    );
  });

  it("cursor diff expression log line format is documented", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md Cursor diff expression section
    expect(text).toContain("Cursor diff expression (Step 11)");
    // Verbatim from cursor.md diff log line format
    expect(text).toContain("pending-added");
    expect(text).toContain("pending-removed");
  });

  it("dashboardLink is used verbatim for deep links, not a constructed workspace token", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md Workspace identifier capture section
    expect(text).toContain("Workspace identifier capture");
    expect(text).toContain("`dashboardLink`");
  });
});
