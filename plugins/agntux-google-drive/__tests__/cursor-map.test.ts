/**
 * cursor-map.test.ts — agntux-google-drive
 *
 * Asserts the hybrid cursor shape: a JSON object with a scalar `watermark`
 * (ISO-8601 UTC) plus a per-fileId `files` map (fileId → ISO-8601 UTC).
 *
 * Golden-rule compliance:
 *  - All toContain strings are copied verbatim from the rendered reference/cursor.md
 *    (wholesale override — rendered content is identical to the override source).
 *  - JSON-parse assertions use the literal cursor strings from the sync.md
 *    examples embedded in cursor.md; those examples are the machine-readable
 *    contract (source of truth #1 / #2).
 *  - No assertion invents a field name or phrase not confirmed by reading the file.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-google-drive";

// Cursor JSON strings taken verbatim from the sync.md examples in cursor.md.
// These are the canonical examples of the documented cursor format.
const CURSOR_AFTER_FIRST_RUN =
  '{"watermark":"2026-06-19T10:00:00Z","files":{"1BxiMVs0XRA5nFM":"2026-06-19T09:50:00Z","1K2gHhJtFqrs7nA":"2026-06-18T14:00:00Z","0APmkLXb5uuXQUk9PVA":"2026-06-17T11:30:00Z"}}';

const CURSOR_AFTER_EVICTION =
  '{"watermark":"2026-06-20T08:15:00Z","files":{"1BxiMVs0XRA5nFM":"2026-06-20T08:10:00Z","1K2gHhJtFqrs7nA":"2026-06-18T14:00:00Z","1newFileIdXyz":"2026-06-20T08:00:00Z","1anotherNewId":"2026-06-19T22:45:00Z"}}';

function cursorRef(): string {
  return readFileSync(
    join(PLUGIN_ROOT, `skills/${SLUG}/reference/cursor.md`),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// Cursor shape documentation (prose assertions — verbatim substrings only)
// ---------------------------------------------------------------------------

describe("cursor shape documentation", () => {
  it("cursor.md names the hybrid strategy", () => {
    // Verbatim from rendered reference/cursor.md (line 17)
    expect(cursorRef()).toContain("**Hybrid time-watermark + per-fileId last-seen map**");
  });

  it("cursor.md documents both top-level keys: watermark and files", () => {
    const body = cursorRef();
    // Verbatim section header from rendered reference/cursor.md
    expect(body).toContain("### Top-level keys");
    expect(body).toContain("`watermark`");
    expect(body).toContain("`files`");
  });

  it("cursor.md documents that the files map contains only bare fileId keys — no tracked-parent # separator", () => {
    // Verbatim from rendered reference/cursor.md (conclusion paragraph, lines 80-82)
    const body = cursorRef();
    // Two short anchors — each fits on one line in the file
    expect(body).toContain("**Conclusion: no tracked-parent registry.**");
    expect(body).toContain("contains only bare `<fileId>` entries.");
  });

  it("cursor.md documents that fileId must not be normalised or truncated", () => {
    // Verbatim from rendered reference/cursor.md
    expect(cursorRef()).toContain("Do not\nnormalise, truncate, or alias them.");
  });

  it("cursor.md documents null as the bootstrap cursor value", () => {
    // Verbatim from rendered reference/cursor.md (bootstrap state code block)
    expect(cursorRef()).toContain("cursor: null");
  });

  it("cursor.md documents the malformed-cursor fallback error kind", () => {
    // Verbatim from rendered reference/cursor.md
    expect(cursorRef()).toContain("log `google-drive-cursor-malformed`");
  });

  it("cursor.md documents the max-of-processed-files watermark advance rule", () => {
    // Verbatim from rendered reference/cursor.md
    expect(cursorRef()).toContain("new_watermark = max(modifiedTime)");
  });
});

// ---------------------------------------------------------------------------
// JSON round-trip: example cursor strings embedded in cursor.md
// ---------------------------------------------------------------------------

describe("cursor JSON round-trip (after-first-run example)", () => {
  it("parses to an object with watermark and files top-level keys", () => {
    const cursor = JSON.parse(CURSOR_AFTER_FIRST_RUN) as {
      watermark: string;
      files: Record<string, string>;
    };
    expect(typeof cursor.watermark).toBe("string");
    expect(typeof cursor.files).toBe("object");
    expect(cursor.files).not.toBeNull();
  });

  it("watermark value matches ISO-8601 UTC format", () => {
    const cursor = JSON.parse(CURSOR_AFTER_FIRST_RUN) as { watermark: string };
    expect(cursor.watermark).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("files map values are all ISO-8601 UTC timestamps", () => {
    const cursor = JSON.parse(CURSOR_AFTER_FIRST_RUN) as {
      files: Record<string, string>;
    };
    const iso8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    for (const [id, ts] of Object.entries(cursor.files)) {
      expect(ts, `files["${id}"] is not ISO-8601 UTC`).toMatch(iso8601);
    }
  });

  it("files map has exactly the three documented fileIds", () => {
    const cursor = JSON.parse(CURSOR_AFTER_FIRST_RUN) as {
      files: Record<string, string>;
    };
    expect(Object.keys(cursor.files).sort()).toEqual([
      "0APmkLXb5uuXQUk9PVA",
      "1BxiMVs0XRA5nFM",
      "1K2gHhJtFqrs7nA",
    ]);
  });

  it("watermark is not less than any files map value (max-of-processed invariant)", () => {
    const cursor = JSON.parse(CURSOR_AFTER_FIRST_RUN) as {
      watermark: string;
      files: Record<string, string>;
    };
    for (const [id, ts] of Object.entries(cursor.files)) {
      expect(
        cursor.watermark >= ts,
        `watermark ${cursor.watermark} predates files["${id}"] = ${ts}`,
      ).toBe(true);
    }
  });

  it("files map keys contain no # separator (no tracked-parent / comment-scoped entries)", () => {
    const cursor = JSON.parse(CURSOR_AFTER_FIRST_RUN) as {
      files: Record<string, string>;
    };
    for (const key of Object.keys(cursor.files)) {
      expect(key, `files key "${key}" contains a # separator`).not.toContain("#");
    }
  });

  it("adding a new fileId preserves all existing entries", () => {
    const cursor = JSON.parse(CURSOR_AFTER_FIRST_RUN) as {
      watermark: string;
      files: Record<string, string>;
    };
    const newId = "1brandNewFileIdXX";
    const newTs = "2026-06-19T11:00:00Z";
    const updated = { ...cursor, files: { ...cursor.files, [newId]: newTs } };
    // All original entries intact
    expect(updated.files["1BxiMVs0XRA5nFM"]).toBe("2026-06-19T09:50:00Z");
    expect(updated.files["1K2gHhJtFqrs7nA"]).toBe("2026-06-18T14:00:00Z");
    expect(updated.files["0APmkLXb5uuXQUk9PVA"]).toBe("2026-06-17T11:30:00Z");
    // New entry present
    expect(updated.files[newId]).toBe(newTs);
  });

  it("JSON.stringify round-trip preserves the cursor object faithfully", () => {
    const cursor = JSON.parse(CURSOR_AFTER_FIRST_RUN);
    expect(JSON.parse(JSON.stringify(cursor))).toEqual(cursor);
  });
});

// ---------------------------------------------------------------------------
// JSON round-trip: after-eviction example
// ---------------------------------------------------------------------------

describe("cursor JSON round-trip (after-eviction example)", () => {
  it("parses successfully with the evicted fileId absent from files map", () => {
    const cursor = JSON.parse(CURSOR_AFTER_EVICTION) as {
      watermark: string;
      files: Record<string, string>;
    };
    expect(typeof cursor.watermark).toBe("string");
    // 0APmkLXb5uuXQUk9PVA was present in CURSOR_AFTER_FIRST_RUN but was documented
    // as evicted (permanent 404) — it must not be in the eviction-example cursor.
    expect(Object.keys(cursor.files)).not.toContain("0APmkLXb5uuXQUk9PVA");
  });

  it("after-eviction watermark is not less than any remaining files map value", () => {
    const cursor = JSON.parse(CURSOR_AFTER_EVICTION) as {
      watermark: string;
      files: Record<string, string>;
    };
    for (const [id, ts] of Object.entries(cursor.files)) {
      expect(
        cursor.watermark >= ts,
        `watermark ${cursor.watermark} predates files["${id}"] = ${ts}`,
      ).toBe(true);
    }
  });

  it("after-eviction watermark advances past the after-first-run watermark", () => {
    const before = JSON.parse(CURSOR_AFTER_FIRST_RUN) as { watermark: string };
    const after = JSON.parse(CURSOR_AFTER_EVICTION) as { watermark: string };
    expect(after.watermark > before.watermark).toBe(true);
  });
});
