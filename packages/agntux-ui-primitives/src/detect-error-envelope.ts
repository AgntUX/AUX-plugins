/**
 * Detect an MCP-layer error envelope returned by `tools/call`.
 *
 * Author: AgntUX
 * License: ELv2
 *
 * The `@agntux/mcp-license` gate (and any tool-level error path) returns
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

const PAYLOAD_META_KEYS = new Set(["_content", "_meta"]);

export function detectErrorEnvelope(
  toolOutput: Record<string, unknown> | undefined,
): string | null {
  if (!toolOutput) return null;
  for (const key of Object.keys(toolOutput)) {
    if (!PAYLOAD_META_KEYS.has(key)) return null;
  }
  const content = toolOutput._content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0] as { type?: unknown; text?: unknown } | undefined;
  if (
    !first ||
    first.type !== "text" ||
    typeof first.text !== "string" ||
    first.text.length === 0
  ) {
    return null;
  }
  return first.text;
}
