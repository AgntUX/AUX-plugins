/**
 * Spinner — inline pulsing-dot indicator.
 *
 * Author: AgntUX
 * License: ELv2
 *
 * Pure inline SVG so the component bundle has no icon-library dependency.
 * Three dots, animated by the same Tailwind `animate-pulse` keyframes used
 * elsewhere in the template, with staggered `animation-delay` to produce the
 * walking-dots effect.
 */

import type { CSSProperties } from 'react';

export interface SpinnerProps {
  /** Pixel size of each dot. Defaults to 6. */
  size?: number;
  /** ARIA label announced by screen readers. */
  label?: string;
  /** Additional class names for the root element. */
  className?: string;
}

export function Spinner({
  size = 6,
  label = 'Loading',
  className = '',
}: SpinnerProps) {
  const dotStyle: CSSProperties = { width: size, height: size };
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-flex items-center gap-1 ${className}`}
    >
      <span
        className="inline-block animate-pulse rounded-full bg-current"
        style={{ ...dotStyle, animationDelay: '0ms' }}
      />
      <span
        className="inline-block animate-pulse rounded-full bg-current"
        style={{ ...dotStyle, animationDelay: '150ms' }}
      />
      <span
        className="inline-block animate-pulse rounded-full bg-current"
        style={{ ...dotStyle, animationDelay: '300ms' }}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
