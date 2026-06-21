// external-link.tsx — <button>+openLink wrapper.
//
// Sandboxed iframes block <a href> navigation. ALL external links MUST use
// this component (or call useAppsClient().openLink() directly).
// Never render <a href="..."> for external URLs.

import { useAppsClient } from '../lib/apps-react/index.js';

interface ExternalLinkProps {
  href: string | null | undefined;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function ExternalLink({
  href,
  children,
  className = '',
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
