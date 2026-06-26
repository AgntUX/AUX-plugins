// =============================================================================
// external-link.tsx — <button>+openLink wrapper (briefing-learnings §1.7).
//
// Sandboxed iframes block <a href> navigation. ALL external links MUST use
// this component (or call useAppsClient().openLink() directly).
// =============================================================================

import { useAppsClient } from "../lib/apps-react/index.js";

interface ExternalLinkProps {
  href: string | null | undefined;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

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
