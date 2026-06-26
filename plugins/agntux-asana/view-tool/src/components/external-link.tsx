// =============================================================================
// external-link.tsx — <button>+openLink wrapper (briefing-learnings §1.7).
//
// Sandboxed iframes block <a href> navigation. ALL external links MUST use
// this component (or call useAppsClient().openLink() directly). Never render
// <a href="..."> for external URLs.
// =============================================================================

import React from "react";
import { useAppsClient } from "../lib/apps-react/index.js";

interface ExternalLinkProps {
  /** The URL to open via the host's openLink(). When empty/null, renders as a <span>. */
  href: string | null | undefined;
  /** Button label content. */
  children: React.ReactNode;
  /** Additional class names for the button. */
  className?: string;
  /** aria-label override when children is not a descriptive string. */
  ariaLabel?: string;
}

/**
 * ExternalLink — renders a <button> that calls useAppsClient().openLink(href).
 * When href is empty or null, renders a plain <span> so the UI doesn't break.
 * Per briefing-learnings §1.7: no <a href> for external URLs in sandboxed iframes.
 */
export function ExternalLink({
  href,
  children,
  className = "",
  ariaLabel,
}: ExternalLinkProps) {
  const client = useAppsClient();

  if (!href) {
    return <span className={className}>{children}</span>;
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      onClick={() => {
        void client.openLink(href);
      }}
    >
      {children}
    </button>
  );
}
