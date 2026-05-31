// Single source of truth for the render console-error WIRE FORMAT: the shape
// the CLI prints (`  console error: <text>  @ <url>:<line>:<col>`) and the
// cap/normalisation applied to the renderer's raw console-error array. The
// validate gate's `parseConsoleErrors` (scripts/validate-plugin.mjs) parses
// the line this module formats — they are two halves of one contract, so a
// round-trip test composes `formatConsoleErrorLine` with that parser to prove
// the printer and parser never drift apart. Pure functions, zero imports.

export const MAX_CONSOLE_ERRORS = 5;
export const MAX_CONSOLE_ERROR_TEXT = 500;

/**
 * Bound the console-error array a render summary carries back to the CLI: first
 * MAX_CONSOLE_ERRORS entries, each text capped to MAX_CONSOLE_ERROR_TEXT (with
 * an explicit truncation marker so a half-message isn't read as complete), and
 * location normalised to {url,line,col}. Playwright's msg.location() is
 * {url,lineNumber,columnNumber}; the pageerror branch has none. Keeps the
 * parsed validate verdict small while still telling the model the real message.
 */
export function capConsoleErrors(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_CONSOLE_ERRORS).map((e) => {
    const raw = String(e?.text ?? "");
    const text =
      raw.length > MAX_CONSOLE_ERROR_TEXT
        ? `${raw.slice(0, MAX_CONSOLE_ERROR_TEXT)}…[truncated]`
        : raw;
    const loc = e?.location;
    // Keep the location when EITHER a url or a line number is present (some
    // console messages have an empty url but meaningful line/col).
    const hasLoc = loc && (loc.url || loc.lineNumber != null);
    return {
      type: e?.type ?? "error",
      text,
      location: hasLoc
        ? { url: loc.url ?? "", line: loc.lineNumber ?? null, col: loc.columnNumber ?? null }
        : null,
    };
  });
}

/**
 * Render ONE capped console error as the single line the validate gate greps.
 * Newlines are collapsed to ` ⏎ ` so a multi-line React stack stays one line
 * (the parser is line-oriented). The location suffix uses a DOUBLE space before
 * `@` and always ends `:<line>:<col>` — the parser keys off exactly that shape
 * to split the message from the location, so this format is load-bearing.
 */
export function formatConsoleErrorLine(ce) {
  const text = String(ce?.text ?? "").replace(/\s*\n\s*/g, " ⏎ ");
  const loc = ce?.location?.url
    ? `  @ ${ce.location.url}:${ce.location.line ?? 0}:${ce.location.col ?? 0}`
    : "";
  return `  console error: ${text}${loc}`;
}
