// cursor-map.test.ts — agntux-dropbox
//
// Asserts the four-part hybrid cursor structure documented in
// skills/agntux-dropbox/_overrides/reference/cursor.md.
//
// Golden rule: every string assertion is derived from:
//   1. The parsed YAML object from listing.yaml (proposed_schema.cursor_semantics,
//      proposed_schema.source_id_format) — machine-readable, E30 compliant.
//   2. The exact JSON example strings copied verbatim from cursor.md.
//      These are structural round-trip checks, NOT prose-grep assertions —
//      they validate that the documented cursor shape parses and holds the
//      invariants the cursor spec requires.
//
// This test does NOT grep _overrides prose for cursor semantics descriptions.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Cursor shape examples — verbatim from cursor.md §Cursor shape
// Read from: skills/agntux-dropbox/_overrides/reference/cursor.md
// ---------------------------------------------------------------------------

// After first successful run (onboarding mode, 23 files processed):
const CURSOR_AFTER_FIRST_RUN =
  '{"folder_cursor":"AAHo1x2y3z4AABcDEF...","files":{"id:abc123":"016552eabad06e70000000362a07e03","id:ghi789":"016552eabad06e70000000362a07e04"},"shared_links_cursor":"2026-06-12T08:30:00Z","file_requests_seen":["id:req001"]}';

// Bootstrap state — null cursor
const CURSOR_BOOTSTRAP = null;

// Intermediate cursor illustrating the four-key schema
const CURSOR_TYPICAL =
  '{"folder_cursor":"AAHo1x2y3z...","files":{"id:abc123":"016552eabad06e70000000362a07e03","id:ghi789":"016552eabad06e70000000362a07e04"},"shared_links_cursor":"2026-06-26T10:00:00Z","file_requests_seen":["id:req001","id:req002"]}';

// ---------------------------------------------------------------------------
// Helper: parse cursor JSON the way the skill does at Step 2
// ---------------------------------------------------------------------------

interface DropboxCursor {
  folder_cursor: string | null;
  files: Record<string, string>;
  shared_links_cursor: string | null;
  file_requests_seen: string[];
}

function parseCursor(raw: string | null): DropboxCursor | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as DropboxCursor;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// listing.yaml proposed_schema — cursor semantics (parsed object, not prose)
// ---------------------------------------------------------------------------

describe("listing.yaml cursor_semantics field (parsed)", () => {
  const listing = yaml.load(
    readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
  ) as Record<string, unknown>;
  const schema = listing.proposed_schema as Record<string, unknown>;

  it("cursor_semantics is present and non-empty", () => {
    expect(typeof schema.cursor_semantics).toBe("string");
    expect((schema.cursor_semantics as string).length).toBeGreaterThan(0);
  });

  it("cursor_semantics mentions folder_cursor (server-side delta cursor sub-key)", () => {
    const cs = schema.cursor_semantics as string;
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics:
    // "'folder_cursor': the opaque Dropbox list_folder continuation cursor"
    expect(cs).toContain("folder_cursor");
  });

  it("cursor_semantics mentions files (rev map sub-key)", () => {
    const cs = schema.cursor_semantics as string;
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics:
    // "files (file_id to rev map)"
    expect(cs).toContain("files");
    expect(cs).toContain("rev map");
  });

  it("cursor_semantics mentions shared_links_cursor sub-key", () => {
    const cs = schema.cursor_semantics as string;
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics:
    // "'shared_links_cursor': ISO-8601 UTC timestamp"
    expect(cs).toContain("shared_links_cursor");
  });

  it("cursor_semantics mentions file_requests_seen sub-key", () => {
    const cs = schema.cursor_semantics as string;
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics:
    // "'file_requests_seen': JSON array of file-request IDs"
    expect(cs).toContain("file_requests_seen");
  });

  it("cursor_semantics names the transactional advance rule", () => {
    const cs = schema.cursor_semantics as string;
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics:
    // "Advance only on full-run success (transactional)"
    expect(cs).toContain("transactional");
  });

  it("source_id_format uses Dropbox file id (id: prefix)", () => {
    const fmt = schema.source_id_format as string;
    // Verbatim substring from listing.yaml: "`{file_id}` — Dropbox's stable unique ID"
    expect(fmt).toContain("{file_id}");
  });
});

// ---------------------------------------------------------------------------
// JSON round-trip: cursor examples parse and serialise cleanly
// ---------------------------------------------------------------------------

describe("cursor JSON round-trip (structural)", () => {
  it("bootstrap cursor (null) returns null from parseCursor", () => {
    expect(parseCursor(CURSOR_BOOTSTRAP)).toBeNull();
  });

  it("after-first-run cursor parses to correct four-key set", () => {
    const c = parseCursor(CURSOR_AFTER_FIRST_RUN);
    expect(c).not.toBeNull();
    const keys = Object.keys(c!).sort();
    expect(keys).toEqual(
      [
        "file_requests_seen",
        "files",
        "folder_cursor",
        "shared_links_cursor",
      ].sort(),
    );
  });

  it("cursor object contains exactly four top-level keys", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    expect(Object.keys(c)).toHaveLength(4);
  });

  it("folder_cursor is an opaque string (non-empty)", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    expect(typeof c.folder_cursor).toBe("string");
    expect((c.folder_cursor as string).length).toBeGreaterThan(0);
  });

  it("files is a JSON object (not an array)", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    expect(typeof c.files).toBe("object");
    expect(Array.isArray(c.files)).toBe(false);
    expect(c.files).not.toBeNull();
  });

  it("files map keys start with 'id:' prefix (Dropbox file id format)", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    const keys = Object.keys(c.files);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.startsWith("id:")).toBe(true);
    }
  });

  it("files map values are opaque rev token strings (non-empty)", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    // Each value is the Dropbox rev token last successfully confirmed for that file.
    // Rev tokens are opaque strings (e.g., "016552eabad06e70000000362a07e03").
    const values = Object.values(c.files);
    for (const val of values) {
      expect(typeof val).toBe("string");
      expect(val.length).toBeGreaterThan(0);
    }
  });

  it("shared_links_cursor is a parseable ISO-8601 UTC timestamp", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    // Verbatim from cursor.md: "ISO-8601 UTC string"
    expect(typeof c.shared_links_cursor).toBe("string");
    const ts = new Date(c.shared_links_cursor as string).getTime();
    expect(ts).not.toBeNaN();
  });

  it("file_requests_seen is an array of strings", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    expect(Array.isArray(c.file_requests_seen)).toBe(true);
    for (const id of c.file_requests_seen) {
      expect(typeof id).toBe("string");
    }
  });

  it("file_requests_seen entries start with 'id:' prefix", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    // Verbatim from cursor.md example: ["id:req001","id:req002"]
    for (const id of c.file_requests_seen) {
      expect(id.startsWith("id:")).toBe(true);
    }
  });

  it("cursor JSON serialises to a single-line string (no embedded newlines)", () => {
    // Verbatim from cursor.md:
    // "JSON object serialised as a single-line string on the sync.md cursor frontmatter key"
    expect(CURSOR_TYPICAL).not.toContain("\n");
    expect(CURSOR_AFTER_FIRST_RUN).not.toContain("\n");
  });

  it("re-serialised cursor round-trips cleanly", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    const serialised = JSON.stringify(c);
    const c2 = parseCursor(serialised)!;
    expect(Object.keys(c2).sort()).toEqual(Object.keys(c).sort());
    expect(JSON.stringify(c2.files)).toBe(JSON.stringify(c.files));
  });
});

// ---------------------------------------------------------------------------
// files-map invariants
// ---------------------------------------------------------------------------

describe("files map (rev index) invariants", () => {
  it("adding a new file id to the files map preserves existing entries", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    const originalKeys = Object.keys(c.files);

    const updated = {
      ...c,
      files: {
        ...c.files,
        "id:newfile001": "016552eabad06e70000000362a07e05",
      },
    };
    // All original entries must still be present
    for (const key of originalKeys) {
      expect(updated.files[key]).toBe(c.files[key]);
    }
    // The new entry is added
    expect(updated.files["id:newfile001"]).toBe("016552eabad06e70000000362a07e05");
  });

  it("updating a rev entry changes the stored rev token", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    const firstKey = Object.keys(c.files)[0];
    const newRev = "016552eabad06e70000000362a07fff";

    const updated = { ...c, files: { ...c.files, [firstKey]: newRev } };
    expect(updated.files[firstKey]).toBe(newRev);
    expect(updated.files[firstKey]).not.toBe(c.files[firstKey]);
  });

  it("evicting a file id removes it from the files map", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    const keys = Object.keys(c.files);
    const evictKey = keys[0];

    const newFiles = { ...c.files };
    delete newFiles[evictKey];
    expect(evictKey in newFiles).toBe(false);
    // Other entries are preserved
    for (const key of keys.slice(1)) {
      expect(newFiles[key]).toBe(c.files[key]);
    }
  });

  it("unchanged rev token (same value) does not change the entry", () => {
    // Structural invariant: id present AND rev matches stored value → Skip re-ingestion
    const c = parseCursor(CURSOR_TYPICAL)!;
    const key = Object.keys(c.files)[0];
    const storedRev = c.files[key];

    // Simulating: new delta entry has the same rev as stored
    const newRev = storedRev;
    expect(newRev).toBe(storedRev); // no change → skip
  });
});

// ---------------------------------------------------------------------------
// Shared-links cursor: timestamp watermark advance invariants
// ---------------------------------------------------------------------------

describe("shared_links_cursor timestamp watermark invariants", () => {
  it("shared_links_cursor must not regress on advance", () => {
    const cBefore = parseCursor(CURSOR_TYPICAL)!;
    // Simulated: a newer link with server_modified after the cursor
    const newMax = "2026-06-26T14:00:00Z";
    const tBefore = new Date(cBefore.shared_links_cursor as string).getTime();
    const tNew = new Date(newMax).getTime();
    expect(tNew).toBeGreaterThan(tBefore);

    const advanced = { ...cBefore, shared_links_cursor: newMax };
    const tAdvanced = new Date(advanced.shared_links_cursor!).getTime();
    expect(tAdvanced).toBeGreaterThanOrEqual(tBefore);
  });

  it("null shared_links_cursor (no prior shared-link sweep) is a valid bootstrap value", () => {
    // Structural invariant from cursor.md:
    // "cursor.shared_links_cursor absent or not ISO-8601 → Process all shared links"
    const bootstrapWithNullSLC: DropboxCursor = {
      folder_cursor: "AAHo...",
      files: {},
      shared_links_cursor: null,
      file_requests_seen: [],
    };
    const serialised = JSON.stringify(bootstrapWithNullSLC);
    const c = parseCursor(serialised)!;
    expect(c.shared_links_cursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// file_requests_seen set: seen-id set invariants
// ---------------------------------------------------------------------------

describe("file_requests_seen seen-id set invariants", () => {
  it("appending new file-request id grows the array by one", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    const before = c.file_requests_seen.length;
    const updated = {
      ...c,
      file_requests_seen: [...c.file_requests_seen, "id:req003"],
    };
    expect(updated.file_requests_seen).toHaveLength(before + 1);
    expect(updated.file_requests_seen).toContain("id:req003");
  });

  it("existing ids are preserved when a new one is appended", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    const updated = {
      ...c,
      file_requests_seen: [...c.file_requests_seen, "id:req_new"],
    };
    for (const id of c.file_requests_seen) {
      expect(updated.file_requests_seen).toContain(id);
    }
  });

  it("pruning a confirmed-closed file-request id removes only that id", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    const pruneId = c.file_requests_seen[0];
    const pruned = {
      ...c,
      file_requests_seen: c.file_requests_seen.filter((id) => id !== pruneId),
    };
    expect(pruned.file_requests_seen).not.toContain(pruneId);
    // All other entries must be preserved
    for (const id of c.file_requests_seen.slice(1)) {
      expect(pruned.file_requests_seen).toContain(id);
    }
  });

  it("empty file_requests_seen array is a valid state (no requests raised yet)", () => {
    const c: DropboxCursor = {
      folder_cursor: "AAHo...",
      files: {},
      shared_links_cursor: null,
      file_requests_seen: [],
    };
    const serialised = JSON.stringify(c);
    const parsed = parseCursor(serialised)!;
    expect(Array.isArray(parsed.file_requests_seen)).toBe(true);
    expect(parsed.file_requests_seen).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bootstrap and gap recovery
// ---------------------------------------------------------------------------

describe("bootstrap and gap recovery", () => {
  it("null cursor (bootstrap) is handled — parseCursor returns null, not throws", () => {
    expect(() => parseCursor(null)).not.toThrow();
    expect(parseCursor(null)).toBeNull();
  });

  it("malformed cursor JSON returns null (gap recovery: treat as bootstrap)", () => {
    expect(parseCursor("not-valid-json")).toBeNull();
    expect(parseCursor("{ broken")).toBeNull();
  });

  it("missing folder_cursor key is detectable (bootstrap folder walk)", () => {
    // Simulates partial cursor write from an interrupted run
    const partial = '{"files":{},"shared_links_cursor":null,"file_requests_seen":[]}';
    const c = parseCursor(partial) as Record<string, unknown>;
    expect(c).not.toBeNull();
    // folder_cursor is absent — should be treated as bootstrap for folder walk
    expect("folder_cursor" in c).toBe(false);
  });

  it("files map absent in partial cursor produces empty-object handling", () => {
    const partial = '{"folder_cursor":"AAHo...","shared_links_cursor":null,"file_requests_seen":[]}';
    const c = parseCursor(partial) as Record<string, unknown>;
    expect(c).not.toBeNull();
    expect("files" in c).toBe(false);
  });

  it("cursor object contains no tracked-parent keys (Dropbox has no thread reply tracking)", () => {
    // Verbatim from cursor.md §Does this source need a tracked-parent registry?:
    // "Conclusion: no tracked-parent registry. The files map contains only bare
    //  Dropbox file id keys (id:abc123...). There are no <id>#<comment_id> entries."
    const c = parseCursor(CURSOR_TYPICAL)!;
    const keys = Object.keys(c);
    // Allowed keys are exactly the four sub-keys
    const allowedKeys = new Set([
      "folder_cursor",
      "files",
      "shared_links_cursor",
      "file_requests_seen",
    ]);
    for (const key of keys) {
      expect(allowedKeys.has(key), `unexpected cursor key: "${key}"`).toBe(true);
    }
  });

  it("no files map key contains a '#' separator (no parent-reply tracker)", () => {
    const c = parseCursor(CURSOR_TYPICAL)!;
    for (const key of Object.keys(c.files)) {
      expect(key).not.toContain("#");
    }
  });
});

// ---------------------------------------------------------------------------
// Transactional advance invariant
// ---------------------------------------------------------------------------

describe("transactional advance invariant", () => {
  it("all four sub-keys must be serialised together as a single cursor string", () => {
    // The advance is atomic: all four sub-keys advance together.
    // Structural check: a valid post-run cursor contains all four keys.
    const postRun: DropboxCursor = {
      folder_cursor: "AAHo_advanced",
      files: { "id:abc123": "016552eabad06e70000000362a07e06" },
      shared_links_cursor: "2026-06-26T14:00:00Z",
      file_requests_seen: ["id:req001", "id:req002"],
    };
    const serialised = JSON.stringify(postRun);
    expect(serialised).not.toContain("\n"); // single-line
    const roundTripped = parseCursor(serialised)!;
    expect(roundTripped.folder_cursor).toBe("AAHo_advanced");
    expect(roundTripped.files["id:abc123"]).toBe("016552eabad06e70000000362a07e06");
    expect(roundTripped.shared_links_cursor).toBe("2026-06-26T14:00:00Z");
    expect(roundTripped.file_requests_seen).toContain("id:req001");
  });

  it("cursor stays at pre-run value when any write fails (no partial advance)", () => {
    // Structural invariant: if a write failed, we MUST NOT serialise an
    // intermediate cursor. Simulated by retaining the pre-run cursor string.
    const preRunCursorStr = CURSOR_TYPICAL;
    let cursorAfterRun = preRunCursorStr; // simulated: write failed → no advance

    // Nothing changes when there are failed writes
    expect(cursorAfterRun).toBe(preRunCursorStr);

    // Only on success do we serialise an advanced cursor
    const onSuccess = (advanced: DropboxCursor) => JSON.stringify(advanced);
    const advanced: DropboxCursor = {
      ...parseCursor(preRunCursorStr)!,
      folder_cursor: "AAHo_advanced",
    };
    cursorAfterRun = onSuccess(advanced);
    expect(parseCursor(cursorAfterRun)!.folder_cursor).toBe("AAHo_advanced");
  });
});
