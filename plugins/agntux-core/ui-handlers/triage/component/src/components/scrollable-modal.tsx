import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface ScrollableModalProps {
  open: boolean;
  onClose: () => void;
  /** Rendered inside the sticky header; also used for the accessible name. */
  title: ReactNode;
  children: ReactNode;
  /** Actions rendered in the sticky footer (e.g. Cancel / Save buttons). */
  footer?: ReactNode;
  /** Optional override for the accessible name node id. Auto-generated otherwise. */
  labelledBy?: string;
  /** Optional id of the node that describes the modal's content. */
  describedBy?: string;
  /**
   * Optional anchor element. When provided, the modal panel positions itself
   * vertically near the anchor (top edge ~16px below the anchor's top, clamped
   * to the iframe's viewport so the panel never overflows). Horizontally it
   * stays centered. The backdrop still spans the full viewport. When absent,
   * the panel falls back to centered-in-viewport.
   *
   * Used by the triage UI so action-specific modals (Details, Snooze, Dismiss,
   * Do something else) render *over the card the user is actually viewing*
   * instead of yanking them to the iframe center on long lists.
   */
  anchor?: HTMLElement | null;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const VERTICAL_GAP_PX = 16;
// Conservative cap so the anchored panel never reaches the iframe footer chrome.
const MAX_PANEL_HEIGHT = 'min(560px, calc(100vh - 32px))';

/**
 * ScrollableModal — canonical modal primitive for the 600px inline budget.
 *
 * Structure: sticky header + `flex-1 overflow-y-auto` body + sticky footer.
 * Max height is capped at `min(560px, calc(100vh - 32px))` so the primary
 * action in the footer is always reachable inside an inline iframe
 * (~400-600px tall).
 *
 * Accessibility (WCAG AA):
 * - `role="dialog"` + `aria-modal="true"`.
 * - `aria-labelledby` points at the header title (auto-generated id, or the
 *   caller can pass `labelledBy` to reuse their own id).
 * - On open, focus moves to the first focusable element inside the dialog
 *   (close button as a fallback).
 * - Tab/Shift+Tab are trapped within the dialog.
 * - Escape closes the modal.
 * - On close, focus is restored to the element that triggered the open.
 */
export function ScrollableModal({
  open,
  onClose,
  title,
  children,
  footer,
  labelledBy,
  describedBy,
  anchor,
}: ScrollableModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const autoTitleId = useId();
  const titleId = labelledBy ?? autoTitleId;
  const [topOffset, setTopOffset] = useState<number | null>(null);

  // Recompute the anchored top offset whenever the anchor changes or the
  // viewport resizes. Falls back to centered when no anchor is provided.
  //
  // useLayoutEffect (not useEffect) so the offset is computed *before* paint —
  // eliminates the one-frame center flash that would otherwise happen when
  // an anchored modal first mounts. Subsequent resize / scroll updates are
  // fine in the next layout pass. SSR isn't a concern: MCP App iframes
  // execute purely in the browser.
  useLayoutEffect(() => {
    if (!open) return;
    if (!anchor) {
      setTopOffset(null);
      return;
    }
    const compute = () => {
      const rect = anchor.getBoundingClientRect();
      const viewportHeight = window.innerHeight || 0;
      // Try to place the panel just above the card's top edge so the user can
      // see *both* the card and the modal at once. Clamp to a 16px minimum
      // top inset and a bottom inset that leaves the panel fully visible.
      const desiredTop = Math.max(VERTICAL_GAP_PX, rect.top);
      // Cap so the panel doesn't hang off the bottom — assume up to 480px tall.
      const maxTop = Math.max(VERTICAL_GAP_PX, viewportHeight - 480 - VERTICAL_GAP_PX);
      setTopOffset(Math.min(desiredTop, maxTop));
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, anchor]);

  const getFocusables = useCallback((): HTMLElement[] => {
    const root = dialogRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }, []);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;

    const focusables = getFocusables();
    (focusables[0] ?? dialogRef.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = getFocusables();
      if (items.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (
        event.shiftKey &&
        (active === first || !dialogRef.current?.contains(active))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, onClose, getFocusables]);

  // Backdrop layout switches between centered (no anchor) and top-aligned
  // (anchored). Centered uses flex-center; anchored aligns the panel to the
  // computed top offset and uses justify-center for horizontal centering.
  const backdropClass = useMemo(() => {
    if (anchor && topOffset !== null) {
      return 'fixed inset-0 z-50 flex justify-center bg-foreground/40 p-4';
    }
    return 'fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4';
  }, [anchor, topOffset]);

  const panelStyle = useMemo(() => {
    const base: Record<string, string> = { maxHeight: MAX_PANEL_HEIGHT };
    if (anchor && topOffset !== null) {
      base.marginTop = `${topOffset}px`;
      base.alignSelf = 'flex-start';
    }
    return base;
  }, [anchor, topOffset]);

  if (!open) return null;

  return (
    <div
      className={backdropClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg outline-none"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div id={titleId} className="text-sm font-semibold">
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
