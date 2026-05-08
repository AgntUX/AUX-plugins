/**
 * ScrollablePanel — primitive layout: sticky header + scrollable body + sticky footer.
 *
 * Author: AgntUX
 * License: Apache-2.0
 *
 * Use this for any inline-iframe screen that needs to keep its title visible
 * at the top, scroll its body, and keep its primary action visible at the
 * bottom.
 *
 * The optional `onHelpClick` renders a small help button in the header. The
 * caller wires the actual deep-link dispatch (e.g. via host `openLink`); this
 * primitive intentionally has no apps-client dependency.
 */

import type { ReactNode } from "react";

export interface ScrollablePanelProps {
  /** Header title — string or rich node. */
  title: ReactNode;
  /** Called when the user clicks the dismiss button. Omit to hide the button. */
  onDismiss?: () => void;
  /**
   * Called when the user clicks the help button. Omit to hide the button. The
   * caller is responsible for actually opening the link via the host's
   * `openLink` API (or however they want to deep-link).
   */
  onHelpClick?: () => void;
  /** Aria-label for the help button. Defaults to "Help". */
  helpLabel?: string;
  /** Body content — typically the form/list/details for this view. */
  children: ReactNode;
  /** Sticky footer content (e.g. Cancel / Save / Send buttons). Optional. */
  footer?: ReactNode;
}

export function ScrollablePanel({
  title,
  onDismiss,
  onHelpClick,
  helpLabel = "Help",
  children,
  footer,
}: ScrollablePanelProps) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="text-sm font-semibold text-card-foreground">
          {title}
        </div>
        <div className="flex items-center gap-1">
          {onHelpClick ? (
            <button
              type="button"
              onClick={onHelpClick}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={helpLabel}
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
