/**
 * Detect an MCP-layer error envelope returned by `tools/call`.
 *
 * Author: AgntUX
 * License: Apache-2.0
 *
 * Tool-level error paths return
 * `{ isError: true, content: [{ type: "text", text: "..." }] }` — a CallToolResult
 * with no `structuredContent`. The apps-client adapter's `extractToolOutput`
 * preserves the content array under `_content` and the original error flag
 * under `_isError`, so we recognise the envelope by either signal:
 *
 *   1. `_isError === true` — the precise path; preferred when the adapter
 *      preserves the flag.
 *   2. `_isError` absent AND only `_content`/`_meta` keys present — the
 *      legacy heuristic, kept for backward compatibility with adapters
 *      that strip `isError` during extraction.
 *
 * `_isError === false` always returns null — an explicit non-error envelope
 * is never an error, even if the rest of the shape looks heuristic-positive.
 *
 * Returns the user-facing text to surface in the iframe, or null when the
 * shape is anything other than an error envelope.
 */
const HEURISTIC_KEYS = new Set(["_content", "_meta"]);
export function detectErrorEnvelope(toolOutput) {
    if (!toolOutput)
        return null;
    const content = toolOutput._content;
    if (!Array.isArray(content) || content.length === 0)
        return null;
    const first = content[0];
    if (!first ||
        first.type !== "text" ||
        typeof first.text !== "string" ||
        first.text.length === 0) {
        return null;
    }
    // Precise signal — adapter preserved the original `isError` flag.
    if (toolOutput._isError === true)
        return first.text;
    // Explicit non-error wins over the heuristic.
    if (toolOutput._isError === false)
        return null;
    // Heuristic fallback (when the adapter stripped `isError`): only payload-
    // meta keys present means this can't be a real structured tool result.
    for (const key of Object.keys(toolOutput)) {
        if (!HEURISTIC_KEYS.has(key))
            return null;
    }
    return first.text;
}
