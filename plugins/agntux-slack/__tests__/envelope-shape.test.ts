/**
 * envelope-shape.test.ts
 *
 * Pure-string assertions that the regexes documented in skills/draft/SKILL.md
 * Step 6.5 correctly match (and reject) the envelope strings that the compose
 * and canvas components emit.
 *
 * DESIGN NOTE: the component build functions (buildEnvelope, buildCanvasEnvelope)
 * live under ui-handlers/{compose,canvas}/component/src/lib/ which are separate
 * package-boundary workspaces with their own TypeScript configs. Importing them
 * directly from this root-level test would require cross-workspace resolution
 * that is not wired in this package's tsconfig/vitest config.
 *
 * Decision: envelope strings are hand-constructed here following the encoding
 * rules documented in build-envelope.ts and build-canvas-envelope.ts, which
 * were read and verified to match the SKILL.md contract exactly. Each test
 * documents the encoding step it applies so the intent is unambiguous.
 *
 * If the component encoding ever diverges from what these tests construct, the
 * component's own unit tests (ui-handlers/{compose,canvas}/component/__tests__/)
 * will catch the mismatch; this file catches drift between the regex the skill
 * documents and the envelope shape the component produces.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRAFT_MD = join(PLUGIN_ROOT, "skills", "draft", "SKILL.md");

// ---------------------------------------------------------------------------
// Regex literals extracted from SKILL.md Step 6.5
// These are the exact patterns the skill claims to use.
// ---------------------------------------------------------------------------

// Scalar fields use (?:[^»]|»»)* (greedy "any non-» char OR doubled »»") so a
// single unpaired » cannot appear inside a captured scalar — the encoder doubles
// every literal », so the closing delimiter is always a single ». This closes
// the ambiguity that a non-greedy `[\s\S]*?` had against scalar values
// containing the literal substring `», tldr «` (or any other field separator).
//
// List fields keep `[\s\S]*?` — their contents are JSON, validated separately
// by JSON.parse; capture-side ambiguity surfaces as a JSON.parse throw and
// fails closed per Hard Rule 2 in SKILL.md Step 6.5.

const COMPOSE_REGEX =
  /^ux: Use the agntux-slack plugin to commit the drafted reply for action ([\w-]+) with body «((?:[^»]|»»)*)» \(mode: (send|schedule|save_draft)(?:, send_at: (.+?))?\)\.$/;

const CANVAS_REGEX =
  /^ux: Use the agntux-slack plugin to commit the drafted canvas for action ([\w-]+) with title «((?:[^»]|»»)*)», tldr «((?:[^»]|»»)*)», decisions «([\s\S]*?)», open_questions «([\s\S]*?)», followup_message «((?:[^»]|»»)*)»\.$/;

const DISCARD_REGEX =
  /^ux: Use the agntux-slack plugin to discard the (draft|canvas) for action ([\w-]+)\.$/;

// ---------------------------------------------------------------------------
// Helpers matching build-envelope.ts encoding logic (compose — guillemet
// escape only on scalar fields).
// ---------------------------------------------------------------------------

function escapeGuillemets(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

function decodeGuillemets(encoded: string): string {
  return encoded.replace(/««/g, "«").replace(/»»/g, "»");
}

function buildEnvelope(
  action_id: string,
  mode: "send" | "schedule" | "save_draft",
  body: string,
  send_at?: string,
): string {
  const escapedBody = escapeGuillemets(body);
  const modeClause =
    mode === "schedule" && send_at
      ? `mode: schedule, send_at: ${send_at}`
      : `mode: ${mode}`;
  return `ux: Use the agntux-slack plugin to commit the drafted reply for action ${action_id} with body «${escapedBody}» (${modeClause}).`;
}

// ---------------------------------------------------------------------------
// Helpers matching build-canvas-envelope.ts encoding logic (canvas — JSON
// encoding for list fields, guillemet escape for scalar fields). The prior
// `||`-doubling/join scheme had a single-pipe correctness gap; JSON sidesteps
// it because the array boundaries are JSON syntax, not a chosen sentinel.
// ---------------------------------------------------------------------------

function encodeList(items: string[]): string {
  return JSON.stringify(items);
}

function decodeList(encoded: string): string[] {
  const parsed: unknown = JSON.parse(encoded);
  if (!Array.isArray(parsed)) {
    throw new Error(`decodeList: expected JSON array, got ${typeof parsed}`);
  }
  return parsed.map((v) => {
    if (typeof v !== "string") {
      throw new Error(`decodeList: expected string item, got ${typeof v}`);
    }
    return v;
  });
}

function buildCanvasEnvelope(
  action_id: string,
  title: string,
  tldr: string,
  decisions: string[],
  open_questions: string[],
  followup_message: string,
): string {
  return (
    `ux: Use the agntux-slack plugin to commit the drafted canvas for action ${action_id}` +
    ` with title «${escapeGuillemets(title)}»` +
    `, tldr «${escapeGuillemets(tldr)}»` +
    `, decisions «${encodeList(decisions)}»` +
    `, open_questions «${encodeList(open_questions)}»` +
    `, followup_message «${escapeGuillemets(followup_message)}».`
  );
}

// ---------------------------------------------------------------------------
// Sanity-check: regex literals in this file match what SKILL.md documents
// ---------------------------------------------------------------------------

describe("regex literals match SKILL.md Step 6.5", () => {
  const src = readFileSync(DRAFT_MD, "utf-8");

  it("compose regex anchor is present in the skill (with tightened scalar capture)", () => {
    expect(src).toContain(
      "^ux: Use the agntux-slack plugin to commit the drafted reply for action ([\\w-]+) with body «((?:[^»]|»»)*)» \\(mode: (send|schedule|save_draft)(?:, send_at: (.+?))?\\)\\.$",
    );
  });

  it("canvas regex anchor is present in the skill (with tightened scalar captures)", () => {
    expect(src).toContain(
      "^ux: Use the agntux-slack plugin to commit the drafted canvas for action",
    );
    // Tightened scalar capture appears at least three times (title, tldr, followup_message)
    const matches = src.match(/\(\?:\[\^»\]\|»»\)\*/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("discard regex anchor is present in the skill", () => {
    expect(src).toContain(
      "^ux: Use the agntux-slack plugin to discard the (draft|canvas) for action ([\\w-]+)\\.$",
    );
  });

  it("skill documents JSON encoding for canvas list fields (not the prior ||-doubling scheme)", () => {
    expect(src).toContain("JSON-stringifies");
    expect(src).toContain("JSON.parse");
  });
});

// ---------------------------------------------------------------------------
// Compose envelope tests
// ---------------------------------------------------------------------------

describe("compose envelope — send mode", () => {
  const ACTION_ID = "2026-05-04-foo";
  const BODY = "hi";
  const envelope = buildEnvelope(ACTION_ID, "send", BODY);

  it("matches the compose regex", () => {
    expect(COMPOSE_REGEX.test(envelope)).toBe(true);
  });

  it("capture groups: action_id=ACTION_ID, body=BODY, mode=send, send_at=undefined", () => {
    const m = envelope.match(COMPOSE_REGEX)!;
    expect(m[1]).toBe(ACTION_ID);
    expect(m[2]).toBe(BODY);
    expect(m[3]).toBe("send");
    expect(m[4]).toBeUndefined();
  });
});

describe("compose envelope — schedule mode", () => {
  const ACTION_ID = "2026-05-04-foo";
  const BODY = "hi";
  const SEND_AT = "2026-05-05T09:00:00-07:00";
  const envelope = buildEnvelope(ACTION_ID, "schedule", BODY, SEND_AT);

  it("matches the compose regex", () => {
    expect(COMPOSE_REGEX.test(envelope)).toBe(true);
  });

  it("capture groups: mode=schedule, send_at is the RFC 3339 string", () => {
    const m = envelope.match(COMPOSE_REGEX)!;
    expect(m[3]).toBe("schedule");
    expect(m[4]).toBe(SEND_AT);
  });
});

describe("compose envelope — save_draft mode", () => {
  const ACTION_ID = "2026-05-04-foo";
  const BODY = "hi";
  const envelope = buildEnvelope(ACTION_ID, "save_draft", BODY);

  it("matches the compose regex", () => {
    expect(COMPOSE_REGEX.test(envelope)).toBe(true);
  });

  it("capture groups: mode=save_draft, send_at=undefined", () => {
    const m = envelope.match(COMPOSE_REGEX)!;
    expect(m[3]).toBe("save_draft");
    expect(m[4]).toBeUndefined();
  });
});

describe("compose envelope — guillemet escape round-trip", () => {
  it("body containing « and » encodes, matches, and decodes back exactly", () => {
    const ORIGINAL_BODY = "say «hi» now";
    const ACTION_ID = "2026-05-04-foo";
    const envelope = buildEnvelope(ACTION_ID, "send", ORIGINAL_BODY);

    expect(COMPOSE_REGEX.test(envelope)).toBe(true);

    const m = envelope.match(COMPOSE_REGEX)!;
    const decoded = decodeGuillemets(m[2]);
    expect(decoded).toBe(ORIGINAL_BODY);
  });

  it("multi-line body encodes, matches, and decodes preserving the newline", () => {
    const ORIGINAL_BODY = "line1\nline2";
    const ACTION_ID = "2026-05-04-foo";
    const envelope = buildEnvelope(ACTION_ID, "send", ORIGINAL_BODY);

    expect(COMPOSE_REGEX.test(envelope)).toBe(true);

    const m = envelope.match(COMPOSE_REGEX)!;
    const decoded = decodeGuillemets(m[2]);
    expect(decoded).toBe(ORIGINAL_BODY);
    expect(decoded.split("\n")).toHaveLength(2);
  });
});

describe("discard compose envelope", () => {
  it("'discard the draft for action {id}' matches the discard regex with kind=draft", () => {
    const ACTION_ID = "2026-05-04-foo";
    const envelope = `ux: Use the agntux-slack plugin to discard the draft for action ${ACTION_ID}.`;
    expect(DISCARD_REGEX.test(envelope)).toBe(true);
    const m = envelope.match(DISCARD_REGEX)!;
    expect(m[1]).toBe("draft");
    expect(m[2]).toBe(ACTION_ID);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: scalar values containing the literal field-separator substring
//
// These tests prove the tightened (?:[^»]|»»)* scalar capture is robust against
// a user who pastes — accidentally or maliciously — a substring that mimics the
// envelope's own field separators (e.g., `», tldr «` in a canvas title, or
// `» (mode: send)` in a compose body).
//
// Why it matters: with the old non-greedy `[\s\S]*?` capture, the regex engine
// could prematurely terminate the title group at the first `»` it saw, leaving
// the doubled remainder (`», tldr «`) corrupted into the next field's capture.
// The tightened capture only matches a single `»` when it's the closing
// delimiter (because every literal » in the encoded form is doubled to »»).
// ---------------------------------------------------------------------------

describe("adversarial — compose body containing the literal mode-suffix substring", () => {
  it("body '» (mode: send' round-trips byte-for-byte (encoder doubles, decoder un-doubles, regex capture is unambiguous)", () => {
    const ORIGINAL_BODY = "Hey, just saying » (mode: send) totally works now.";
    const envelope = buildEnvelope("2026-05-04-x", "send", ORIGINAL_BODY);
    expect(COMPOSE_REGEX.test(envelope)).toBe(true);
    const m = envelope.match(COMPOSE_REGEX)!;
    const decoded = decodeGuillemets(m[2]);
    expect(decoded).toBe(ORIGINAL_BODY);
    expect(m[3]).toBe("send"); // mode group still parsed correctly
  });

  it("body containing many embedded »» pairs (paranoid case)", () => {
    const ORIGINAL_BODY = "« start » mid « end » « tail »»»»";
    const envelope = buildEnvelope("2026-05-04-x", "save_draft", ORIGINAL_BODY);
    expect(COMPOSE_REGEX.test(envelope)).toBe(true);
    const m = envelope.match(COMPOSE_REGEX)!;
    expect(decodeGuillemets(m[2])).toBe(ORIGINAL_BODY);
  });
});

describe("adversarial — canvas scalars containing the literal field-separator substring", () => {
  it("title containing `», tldr «` round-trips byte-for-byte (regex no longer prematurely terminates)", () => {
    const ORIGINAL_TITLE = "before», tldr «pwn";
    const ORIGINAL_TLDR = "real-tldr";
    const envelope = buildCanvasEnvelope(
      "2026-05-04-x",
      ORIGINAL_TITLE,
      ORIGINAL_TLDR,
      ["d1"],
      ["q1"],
      "fp",
    );
    expect(CANVAS_REGEX.test(envelope)).toBe(true);
    const m = envelope.match(CANVAS_REGEX)!;
    expect(decodeGuillemets(m[2])).toBe(ORIGINAL_TITLE);
    expect(decodeGuillemets(m[3])).toBe(ORIGINAL_TLDR);
  });

  it("tldr containing `», decisions «` round-trips byte-for-byte", () => {
    const ORIGINAL_TLDR = "summary », decisions «not really";
    const envelope = buildCanvasEnvelope(
      "2026-05-04-x",
      "Title",
      ORIGINAL_TLDR,
      ["d1"],
      ["q1"],
      "fp",
    );
    expect(CANVAS_REGEX.test(envelope)).toBe(true);
    const m = envelope.match(CANVAS_REGEX)!;
    expect(decodeGuillemets(m[3])).toBe(ORIGINAL_TLDR);
  });

  it("followup_message containing `»` (final scalar before closing) round-trips byte-for-byte", () => {
    const ORIGINAL_FOLLOWUP = "Posted »» a »summary";
    const envelope = buildCanvasEnvelope(
      "2026-05-04-x",
      "T",
      "TL",
      ["d"],
      ["q"],
      ORIGINAL_FOLLOWUP,
    );
    expect(CANVAS_REGEX.test(envelope)).toBe(true);
    const m = envelope.match(CANVAS_REGEX)!;
    expect(decodeGuillemets(m[6])).toBe(ORIGINAL_FOLLOWUP);
  });
});

// ---------------------------------------------------------------------------
// Canvas envelope tests — JSON-encoded list fields
// ---------------------------------------------------------------------------

describe("canvas envelope — basic round-trip with JSON-encoded lists", () => {
  const ACTION_ID = "2026-05-04-foo";
  const TITLE = "X";
  const TLDR = "Y";
  const DECISIONS = ["d1", "d2"];
  const OPEN_QUESTIONS = ["q1"];
  const FOLLOWUP = "post";

  const envelope = buildCanvasEnvelope(
    ACTION_ID,
    TITLE,
    TLDR,
    DECISIONS,
    OPEN_QUESTIONS,
    FOLLOWUP,
  );

  it("matches the canvas regex", () => {
    expect(CANVAS_REGEX.test(envelope)).toBe(true);
  });

  it("capture groups: title=X, tldr=Y, decisions JSON-decodes to d1+d2, open_questions to q1, followup=post", () => {
    const m = envelope.match(CANVAS_REGEX)!;
    expect(m[1]).toBe(ACTION_ID);
    expect(m[2]).toBe(TITLE);
    expect(m[3]).toBe(TLDR);
    expect(decodeList(m[4])).toEqual(DECISIONS);
    expect(decodeList(m[5])).toEqual(OPEN_QUESTIONS);
    expect(m[6]).toBe(FOLLOWUP);
  });

  it("decisions field renders as a JSON array literal", () => {
    expect(envelope).toContain('decisions «["d1","d2"]»');
  });
});

describe("canvas envelope — single-pipe items round-trip (the bug the prior scheme had)", () => {
  // The prior ||-doubling scheme could not round-trip a single-pipe item.
  // JSON encoding handles literal | as just-another-character, with no
  // reserved item separator that needs escaping.
  it("a decision item containing a single '|' (e.g., a markdown table fragment) round-trips exactly", () => {
    const ACTION_ID = "2026-05-04-foo";
    const DECISIONS = ["vendor A | vendor B comparison", "build vs buy"];
    const envelope = buildCanvasEnvelope(
      ACTION_ID,
      "T",
      "TL",
      DECISIONS,
      ["q1"],
      "fp",
    );

    expect(CANVAS_REGEX.test(envelope)).toBe(true);
    const m = envelope.match(CANVAS_REGEX)!;
    expect(decodeList(m[4])).toEqual(DECISIONS);
  });

  it("a decision item containing '||' (double-pipe) round-trips exactly", () => {
    const ACTION_ID = "2026-05-04-foo";
    const DECISIONS = ["D1 || stuff", "D2"];
    const envelope = buildCanvasEnvelope(
      ACTION_ID,
      "T",
      "TL",
      DECISIONS,
      ["q1"],
      "fp",
    );

    expect(CANVAS_REGEX.test(envelope)).toBe(true);
    const m = envelope.match(CANVAS_REGEX)!;
    expect(decodeList(m[4])).toEqual(DECISIONS);
  });
});

describe("canvas envelope — defensive JSON cases", () => {
  it("a decision item containing JSON-special characters (quote, backslash) round-trips exactly", () => {
    const DECISIONS = ['He said "yes"', "path\\to\\file"];
    const envelope = buildCanvasEnvelope(
      "x",
      "T",
      "TL",
      DECISIONS,
      [],
      "fp",
    );

    expect(CANVAS_REGEX.test(envelope)).toBe(true);
    const m = envelope.match(CANVAS_REGEX)!;
    expect(decodeList(m[4])).toEqual(DECISIONS);
  });

  it("an item containing a newline round-trips exactly", () => {
    const DECISIONS = ["line one\nline two"];
    const envelope = buildCanvasEnvelope(
      "x",
      "T",
      "TL",
      DECISIONS,
      [],
      "fp",
    );

    expect(CANVAS_REGEX.test(envelope)).toBe(true);
    const m = envelope.match(CANVAS_REGEX)!;
    expect(decodeList(m[4])).toEqual(DECISIONS);
  });

  it("an empty list encodes as JSON [] and decodes to an empty array", () => {
    const envelope = buildCanvasEnvelope("x", "T", "TL", [], [], "fp");
    expect(CANVAS_REGEX.test(envelope)).toBe(true);
    expect(envelope).toContain("decisions «[]»");
    expect(envelope).toContain("open_questions «[]»");
    const m = envelope.match(CANVAS_REGEX)!;
    expect(decodeList(m[4])).toEqual([]);
    expect(decodeList(m[5])).toEqual([]);
  });
});

describe("canvas envelope — single-item list", () => {
  it("decisions with one item encodes as a one-element JSON array", () => {
    const DECISIONS = ["only one"];
    const envelope = buildCanvasEnvelope(
      "x",
      "T",
      "TL",
      DECISIONS,
      [],
      "fp",
    );

    expect(CANVAS_REGEX.test(envelope)).toBe(true);
    const m = envelope.match(CANVAS_REGEX)!;
    expect(decodeList(m[4])).toEqual(DECISIONS);
    expect(envelope).toContain('decisions «["only one"]»');
  });
});

describe("discard canvas envelope", () => {
  it("'discard the canvas for action {id}' matches the discard regex with kind=canvas", () => {
    const ACTION_ID = "2026-05-04-foo";
    const envelope = `ux: Use the agntux-slack plugin to discard the canvas for action ${ACTION_ID}.`;
    expect(DISCARD_REGEX.test(envelope)).toBe(true);
    const m = envelope.match(DISCARD_REGEX)!;
    expect(m[1]).toBe("canvas");
    expect(m[2]).toBe(ACTION_ID);
  });
});
