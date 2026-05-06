// =============================================================================
// Toast — transient success / error notifications for triage mutations.
//
// Renders in the top-right of the iframe using `position: fixed`. Auto-dismiss
// after 3s for success messages; error toasts stay visible until the user
// dismisses them or another toast replaces them.
//
// Single-toast policy: a new dispatch replaces any existing toast (no stack).
// Three concurrent dones don't queue three toasts — the last one wins. This
// keeps the surface deliberately small for an inline-budget MCP App.
//
// Accessibility: `role="status"` + `aria-live="polite"` so screen readers
// announce the message without interrupting. The dismiss button is keyboard-
// reachable; Escape inside the iframe also dismisses.
// =============================================================================

import { useEffect } from 'react';

export interface ToastState {
  message: string;
  kind: 'success' | 'error';
  // Monotonically incremented on each new dispatch so re-firing the same text
  // still triggers the auto-dismiss timer reset.
  nonce: number;
}

interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 3000;

export function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    if (toast.kind === 'error') return; // errors persist until acknowledged
    const handle = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(handle);
  }, [toast, onDismiss]);

  if (!toast) return null;

  const palette =
    toast.kind === 'success'
      ? 'border-green-200 bg-green-50 text-green-800'
      : 'border-red-200 bg-red-50 text-red-800';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`toast-${toast.kind}`}
      className={`pointer-events-none fixed right-3 top-3 z-[60] flex max-w-[320px] items-start gap-2 rounded-md border px-3 py-2 text-[0.8125rem] shadow-md ${palette}`}
    >
      <span className="pointer-events-auto flex-1 leading-snug">
        {toast.message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="pointer-events-auto rounded px-1 text-xs opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}
