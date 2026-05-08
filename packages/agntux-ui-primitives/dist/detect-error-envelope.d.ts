/**
 * Detect an MCP-layer error envelope returned by `tools/call`.
 *
 * Author: AgntUX
 * License: Apache-2.0
 *
 * Tool-level error paths return
 * `{ isError: true, content: [{ type: "text", text: "..." }] }` — a CallToolResult
 * with no `structuredContent`. The apps-client adapter's `extractToolOutput`
 * preserves the content array under `_content` but drops the `isError` flag,
 * so we recognise the envelope by its key signature: only `_content` (and
 * optionally `_meta`) — every other shape is treated as a real tool payload.
 *
 * Returns the user-facing text to surface in the iframe, or null when the
 * shape is anything other than an error envelope (including streaming
 * partials, real payloads, and undefined/empty inputs).
 */
export declare function detectErrorEnvelope(toolOutput: Record<string, unknown> | undefined): string | null;
