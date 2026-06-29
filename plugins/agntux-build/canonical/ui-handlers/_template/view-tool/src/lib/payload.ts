// =============================================================================
// payload.ts — shared, dependency-free payload accessors.
//
// Import these from BOTH the view-tool handler (`*-view.ts`, runs in Node) AND
// the iframe components (`*-ui.tsx` / `components/*.tsx`, run in the browser).
// They are pure TypeScript with no runtime imports, so they bundle cleanly on
// either side. NEVER re-author a one-off `str()` inside a view file — import
// from here so every field read coerces the same way.
//
// ── Why this module exists (two shipped incidents) ──────────────────────────
//
// 1. Numeric-id dead buttons (agntux-posthog, 2026-06). Action frontmatter
//    wrote ids unquoted in YAML (`issue_id: 789`, `experiment_id: 55`), so the
//    parser returned a JS `number`. The view read them through a string-only
//    `str(v) = typeof v === "string" ? v : ""`, which threw the number away →
//    the id arrived `""` → the click handler's `if (!id) return` bailed → a
//    fully-enabled button that silently did nothing. `idStr()` coerces a finite
//    number to its string form so a numeric id survives. Use `idStr()` for
//    EVERY identifier field (`*_id`, `*Id`), never `str()`.
//
// 2. Dead "Sources" links (agntux-google-calendar, 2026-06). Ingest wrote
//    `href` values that were filesystem paths (`data/entities/person/x.md`) or
//    empty, and the component rendered them as links anyway. A sandboxed MCP
//    App iframe can only open `http(s):` / `mailto:` via the host bridge, so
//    every other scheme is a dead click. `isOpenableUrl()` is the guard: render
//    a link only when it returns true, otherwise render plain text. The shared
//    <ExternalLink> component already applies this; use it for raw hrefs too.
// =============================================================================

/**
 * Coerce an unknown payload value to a string. Non-strings (number, boolean,
 * object, null, undefined) collapse to `""`. Use for free-text fields where a
 * non-string value is genuinely "no value" (title, body, label).
 *
 * NOTE: for identifier fields use {@link idStr} instead — a numeric id read
 * through `str()` is silently dropped (the posthog dead-button incident).
 */
export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Coerce an unknown payload value to a string IDENTIFIER. Strings pass through;
 * a finite number is stringified (`55` → `"55"`); everything else collapses to
 * `""`. Use for every id-shaped field — YAML frontmatter that writes an id
 * unquoted parses it as a number, and `str()` would throw it away, blanking the
 * field and silently disabling the button that depends on it.
 *
 * `idStr` is a best-effort safety net, NOT the authoritative fix: a large id
 * (a 19-digit Slack/Discord/DB id) already loses precision when YAML parses it
 * as a JS number, before `idStr` runs (`12345678901234567890` →
 * `"12345678901234567000"`), and a very large value stringifies in exponential
 * form. The real fix is to write id fields QUOTED in the action frontmatter
 * (see ingest-prompt-author's "Quote numeric identifier fields in YAML") so the
 * value is a string end-to-end; `idStr` then just passes it through.
 */
export function idStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/**
 * Coerce an unknown payload value to a string array. A single string becomes a
 * one-element array; an array is mapped element-wise through {@link idStr} (so
 * numeric entries survive) with empties dropped; anything else becomes `[]`.
 */
export function strArr(v: unknown): string[] {
  if (typeof v === "string") return v ? [v] : [];
  if (!Array.isArray(v)) return [];
  return v.map(idStr).filter((s) => s.length > 0);
}

/**
 * True only when `href` is a string the host bridge can actually open from a
 * sandboxed iframe: an `http(s):` URL or a `mailto:` link. Filesystem paths,
 * relative paths, empty strings, and non-strings all return false — render
 * those as plain text, never as a link (the dead-Sources-links incident).
 */
export function isOpenableUrl(href: unknown): href is string {
  if (typeof href !== "string") return false;
  // Require a real authority for http(s) (scheme + `//` + at least one more
  // char) and a non-empty recipient for mailto — so degenerate values like
  // `https:foo` (no `//`) or a bare `mailto:` don't render as a live-but-dead
  // link. Mirrors the trust boundary in plugin-runtime's parse-action SAFE_URL.
  return /^(?:https?:\/\/\S|mailto:[^\s@]+@)/i.test(href.trim());
}
