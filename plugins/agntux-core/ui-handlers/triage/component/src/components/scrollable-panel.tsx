/**
 * ScrollablePanel — primitive layout: sticky header + scrollable body + sticky footer.
 *
 * Author: AgntUX
 * License: ELv2
 *
 * Use this for any inline-iframe screen that needs to keep its title visible
 * at the top, scroll its body, and keep its primary action visible at the
 * bottom.
 *
 * Sticky header includes:
 *   - Title (string or ReactNode)
 *   - Optional Dismiss button → calls `onDismiss`
 *   - Optional Help link button → opens via `useAppsClient().openLink(href)`
 *
 * Body is `flex-1 overflow-y-auto`. Footer is sticky at the bottom of the
 * panel (NOT viewport) so primary actions stay reachable even when the body
 * has scrollable content.
 */

import type { ReactNode } from 'react';
import { useAppsClient } from '../lib/apps-react/index.js';

export interface ScrollablePanelProps {
  /** Header title — string or rich node. */
  title: ReactNode;
  /** Called when the user clicks the dismiss button. Omit to hide the button. */
  onDismiss?: () => void;
  /**
   * Optional URL for a "Help" affordance in the header. When present, renders
   * a small help button that opens `helpHref` via the host's `openLink`
   * (so deep-linking is host-mediated, not iframe-navigated).
   */
  helpHref?: string;
  /** Body content — typically the form/list/details for this view. */
  children: ReactNode;
  /** Sticky footer content (e.g. Cancel / Save / Send buttons). Optional. */
  footer?: ReactNode;
}

export function ScrollablePanel({
  title,
  onDismiss,
  helpHref,
  children,
  footer,
}: ScrollablePanelProps) {
  const client = useAppsClient();

  const onHelpClick = () => {
    if (!helpHref) return;
    void client.openLink(helpHref);
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="text-sm font-semibold text-card-foreground">{title}</div>
        <div className="flex items-center gap-1">
          {helpHref ? (
            <button
              type="button"
              onClick={onHelpClick}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Help"
            >
              ?
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Dismiss"
            >
              ×
            </button>
          ) : null}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
      {footer ? (
        <footer className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-border bg-card px-4 py-3">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}
