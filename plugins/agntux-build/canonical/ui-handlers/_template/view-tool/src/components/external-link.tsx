// =============================================================================
// external-link.tsx — <button>+openLink wrapper (briefing-learnings §1.7).
//
// Sandboxed iframes block <a href> navigation. ALL external links MUST use
// this component (or call useAppsClient().openLink() directly). Never render
// <a href="..."> for external URLs.
//
// Scheme guard: a sandboxed iframe can only open `http(s):` / `mailto:` via
// the host bridge. A filesystem path (`data/entities/x.md`), a relative path,
// or an empty value is a DEAD click — so this component renders such hrefs as
// plain text (<span>), never as a clickable link. This is the fix for the
// agntux-google-calendar "Sources" dead-links incident, where ingest wrote
// fs-path hrefs and the component rendered them as links anyway.
// =============================================================================

import { useAppsClient } from "../lib/apps-react/index.js";
import { isOpenableUrl } from "../lib/payload.js";

interface ExternalLinkProps {
  /**
   * The URL to open via the host's openLink(). Rendered as a clickable button
   * ONLY when it is an openable scheme (http(s)/mailto); any other value
   * (filesystem path, relative path, empty, null) renders as a plain <span>.
   */
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
 * When href is not an openable URL (empty, null, a filesystem/relative path, or
 * any non-http(s)/mailto scheme), renders a plain <span> so a dead click is
 * never offered as a link. Per briefing-learnings §1.7: no <a href> for
 * external URLs in sandboxed iframes.
 */
export function ExternalLink({
  href,
  children,
  className = "",
  ariaLabel,
}: ExternalLinkProps) {
  const client = useAppsClient();

  if (!isOpenableUrl(href)) {
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
