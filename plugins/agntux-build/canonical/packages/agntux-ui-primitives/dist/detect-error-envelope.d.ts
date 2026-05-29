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
export declare function detectErrorEnvelope(toolOutput: Record<string, unknown> | undefined): string | null;
