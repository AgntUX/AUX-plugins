/**
 * LicenseErrorScreen — full-surface error envelope renderer.
 *
 * Author: AgntUX
 * License: Apache-2.0
 *
 * Used at the top of `App.tsx` to short-circuit rendering when a tool-level
 * error envelope reaches the iframe. Renders the entire `text` field with
 * `whitespace-pre-wrap` so multi-paragraph messages survive intact.
 *
 * Pair with `detectErrorEnvelope(toolOutput)` to decide when to render this.
 */
export interface LicenseErrorScreenProps {
    /** The full error text from `_content[0].text`. Rendered as-is. */
    message: string;
}
export declare function LicenseErrorScreen({ message }: LicenseErrorScreenProps): import("react/jsx-runtime").JSX.Element;
