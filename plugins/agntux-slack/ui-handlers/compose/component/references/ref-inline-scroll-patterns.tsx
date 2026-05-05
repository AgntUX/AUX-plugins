/**
 * ref-inline-scroll-patterns.tsx
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
 *   - Pixel heights > 560px on modals, panels, or forms
 *   - Modals without `overflow-y-auto` body + capped max-height
 *   - Primary action buttons that aren't sticky
 *
 * Required patterns (demonstrated below):
 *   1. Scrollable root with long list
 *   2. ScrollableModal primitive
 *   3. Scrollable table with sticky thead
 *   4. Form with sticky submit footer
 */

import { useState } from 'react';
import { ScrollableModal } from '../src/components/scrollable-modal.js';

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

// --- Pattern 2: ScrollableModal (canonical modal primitive) ------------------

export function PatternScrollableModal() {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-4">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        New Task
      </button>
      <ScrollableModal
        open={open}
        onClose={() => setOpen(false)}
        title="New Task"
        footer={
          <>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/90"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="new-task-form"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Save
            </button>
          </>
        }
      >
        <form id="new-task-form" className="space-y-4">
          <label className="block">
            <span className="block text-xs font-medium text-foreground">
              Title
            </span>
            <input
              type="text"
              required
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-foreground">
              Description
            </span>
            <textarea
              rows={4}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-foreground">
              Due date
            </span>
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:ring-2 focus:ring-ring"
            />
          </label>
        </form>
      </ScrollableModal>
    </div>
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
        <thead className="sticky top-0 border-b border-border bg-background">
          <tr>
            <th className="px-3 py-2 text-left font-medium">ID</th>
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-muted/30">
              <td className="px-3 py-2">{row.id}</td>
              <td className="px-3 py-2">{row.name}</td>
              <td className="px-3 py-2">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Pattern 4: Form with sticky submit footer -------------------------------

export function PatternStickyFooterForm() {
  return (
    <form className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <label key={i} className="block">
            <span className="block text-xs font-medium text-foreground">
              Field {i + 1}
            </span>
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:ring-2 focus:ring-ring"
            />
          </label>
        ))}
      </div>
      <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background px-4 py-3">
        <button
          type="button"
          className="rounded-md bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/90"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Save
        </button>
      </footer>
    </form>
  );
}
