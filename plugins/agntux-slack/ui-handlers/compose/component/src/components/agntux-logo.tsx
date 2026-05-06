// =============================================================================
// AgntuxLogo — inline SVG mark used in the compose card header.
//
// Two-tone wordmark: "Agnt" picks up `currentColor` (theme-adaptive); "UX"
// renders in the fixed teal→blue→purple gradient that matches the marketing
// site at /Users/johnjordan/agntux-code/app/public/logo.svg.
// =============================================================================

interface AgntuxLogoProps {
  height?: number;
  className?: string;
  ariaLabel?: string;
}

export function AgntuxLogo({
  height = 22,
  className,
  ariaLabel = 'AgntUX',
}: AgntuxLogoProps) {
  const width = (180 / 48) * height;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 180 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={ariaLabel}
      className={className}
    >
      <defs>
        <linearGradient
          id="agntux-logo-ux-gradient-compose"
          x1="108"
          y1="8"
          x2="176"
          y2="42"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#19e6c8" />
          <stop offset="50%" stopColor="#1a8cff" />
          <stop offset="100%" stopColor="#7c5cff" />
        </linearGradient>
      </defs>
      <text
        x="0"
        y="37"
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        fontSize="38"
        fontWeight="800"
        letterSpacing="-1.5px"
      >
        <tspan fill="currentColor">Agnt</tspan>
        <tspan fill="url(#agntux-logo-ux-gradient-compose)">UX</tspan>
      </text>
    </svg>
  );
}
