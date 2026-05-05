import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

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

/**
 * ScrollableModal — canonical modal primitive for the 600px inline budget.
 *
 * Structure: sticky header + `flex-1 overflow-y-auto` body + sticky footer.
 * Max height is capped at `min(560px, calc(100% - 2rem))` so the primary
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
}: ScrollableModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const autoTitleId = useId();
  const titleId = labelledBy ?? autoTitleId;

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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
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
        style={{ maxHeight: 'min(560px, calc(100% - 2rem))' }}
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
