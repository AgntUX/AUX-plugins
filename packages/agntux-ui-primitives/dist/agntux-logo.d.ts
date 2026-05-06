/**
 * AgntuxLogo — inline SVG mark used in component headers.
 *
 * Author: AgntUX
 * License: ELv2
 *
 * Two-tone wordmark: "Agnt" picks up `currentColor` (theme-adaptive); "UX"
 * renders in the fixed teal→blue→purple gradient that matches the marketing
 * site logo. Each consuming iframe has its own document, so a single shared
 * gradient id is collision-safe across handlers.
 *
 * Default size targets a 24px header glyph; callers can override `height`.
 */
export interface AgntuxLogoProps {
    height?: number;
    className?: string;
    ariaLabel?: string;
}
export declare function AgntuxLogo({ height, className, ariaLabel, }: AgntuxLogoProps): import("react/jsx-runtime").JSX.Element;
