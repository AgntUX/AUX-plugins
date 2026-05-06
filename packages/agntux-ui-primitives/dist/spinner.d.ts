/**
 * Spinner — inline pulsing-dot indicator.
 *
 * Author: AgntUX
 * License: ELv2
 *
 * Pure inline SVG so the component bundle has no icon-library dependency.
 * Three dots, animated by Tailwind `animate-pulse` keyframes with staggered
 * `animation-delay` to produce the walking-dots effect.
 */
export interface SpinnerProps {
    /** Pixel size of each dot. Defaults to 6. */
    size?: number;
    /** ARIA label announced by screen readers. */
    label?: string;
    /** Additional class names for the root element. */
    className?: string;
}
export declare function Spinner({ size, label, className, }: SpinnerProps): import("react/jsx-runtime").JSX.Element;
