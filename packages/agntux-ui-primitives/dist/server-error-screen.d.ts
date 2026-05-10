/**
 * ServerErrorScreen — full-surface error envelope renderer.
 *
 * Author: AgntUX
 * License: Apache-2.0
 *
 * Used at the top of `App.tsx` to short-circuit rendering when a tool-level
 * error envelope reaches the iframe (rate limits, auth failures, upstream
 * 5xx, anything the MCP server returned with `isError: true`). Renders the
 * entire `text` field with `whitespace-pre-wrap` so multi-paragraph messages
 * survive intact.
 *
 * Pair with `detectErrorEnvelope(toolOutput)` to decide when to render this.
 */
export interface ServerErrorScreenProps {
    /** The full error text from `_content[0].text`. Rendered as-is. */
    message: string;
}
export declare function ServerErrorScreen({ message }: ServerErrorScreenProps): import("react/jsx-runtime").JSX.Element;
