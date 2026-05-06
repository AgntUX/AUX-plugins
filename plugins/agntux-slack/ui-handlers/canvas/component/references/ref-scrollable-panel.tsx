/**
 * ref-scrollable-panel.tsx
 *
 * Canonical overflow patterns for the 600px inline iframe budget.
 *
 * The host gives inline/inline-card iframes ~400-600px of height
 * (`hostContext.containerDimensions.maxHeight`). Every feature MUST remain
 * fully usable at 600px tall — via INTERNAL scrolling, never by relying on
 * the host to grow the iframe.
 *
 * Banned in inline/inline-card code:
 *   - min-h-screen / h-screen / 100vh / 100dvh
 *   - Pixel heights > 560px on panels or forms
 *   - Modals (ScrollableModal is retired; modals don't anchor to the row
 *     the user clicked and the host's height-overflow guard pushes them
 *     to roughly 1/3 down the iframe regardless of where the user is)
 *   - Primary action buttons that aren't sticky
 *
 * Required patterns (demonstrated below):
 *   1. Scrollable root with long list
 *   2. ScrollablePanel as the top-level layout
 *   3. Scrollable table with sticky thead
 *   4. Form with sticky submit footer (via ScrollablePanel.footer)
 */

import type { ReactNode } from "react";
import { ScrollablePanel } from "@agntux/ui-primitives";

// --- Pattern 1: Scrollable root with long list -------------------------------

export function PatternScrollableList({ items }: { items: string[] }) {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <ul className="divide-y divide-border">
        {items.map((item, i) => (
          <li key={i} className="px-4 py-3 text-sm">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Pattern 2: ScrollablePanel as the top-level layout ----------------------
//
// ScrollablePanel is the default frame for any inline-iframe view. It owns the
// sticky header (with optional dismiss + help buttons), the scrollable body,
// and the sticky footer slot. Anchor "details / edit / confirm" affordances to
// the row that opened them by rendering them inside the body — NOT in a modal.

export function PatternScrollablePanelView({
  title,
  body,
  onCancel,
  onSave,
}: {
  title: string;
  body: ReactNode;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <ScrollablePanel
      title={title}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          >
            Save
          </button>
        </>
      }
    >
      {body}
    </ScrollablePanel>
  );
}

// --- Pattern 3: Scrollable table with sticky thead ---------------------------

export function PatternScrollableTable({
  rows,
}: {
  rows: { id: string; name: string; status: string }[];
}) {
  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border">
            <th className="px-4 py-2 text-left">Name</th>
            <th className="px-4 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border">
              <td className="px-4 py-2">{row.name}</td>
              <td className="px-4 py-2">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Pattern 4: Form with sticky submit (via ScrollablePanel) ----------------

export function PatternFormWithStickySubmit({
  onSubmit,
}: {
  onSubmit: (data: FormData) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
      className="flex h-full flex-col"
    >
      <ScrollablePanel
        title="Edit settings"
        footer={
          <button
            type="submit"
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          >
            Save changes
          </button>
        }
      >
        <div className="space-y-4">
          {Array.from({ length: 20 }, (_, i) => (
            <label key={i} className="block">
              <span className="block text-xs text-muted-foreground">
                Field {i + 1}
              </span>
              <input
                name={`field-${i}`}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
          ))}
        </div>
      </ScrollablePanel>
    </form>
  );
}
