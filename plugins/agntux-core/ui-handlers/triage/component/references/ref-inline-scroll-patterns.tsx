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
 *   - Pixel heights > 560px on inline panels or forms
 *   - Centred modal overlays with anchor-positioning math (the triage UI
 *     used to ship a ScrollableModal primitive that anchored to the row
 *     the user clicked; the height-overflow guard interacted badly with
 *     short iframes and pushed the modal ~⅓ of the way down. Retired in
 *     v6.1.0 in favour of inline expansion panels — see Pattern 2.)
 *   - Primary action buttons that aren't sticky
 *
 * Required patterns (demonstrated below):
 *   1. Scrollable root with long list
 *   2. Inline expansion panel (preferred over modals at this height budget)
 *   3. Scrollable table with sticky thead
 *   4. Form with sticky submit footer
 */

import { useState } from 'react';

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

// --- Pattern 2: Inline expansion panel ---------------------------------------
//
// Preferred over modals at this height budget. Click the trigger to expand
// a panel inside the row's card; click again (or Cancel) to collapse. No
// overlay, no positioning math, no focus-jump — the row stays in place and
// the form lives inside it.

export function PatternInlineExpansion() {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-sm">
      <h3 className="text-sm font-semibold">Reply to partner-platforms thread</h3>
      <p className="text-xs text-muted-foreground">
        Avery DM'd you asking for delivery confidence on Apex Phase 2.
      </p>
      <div className="flex items-center gap-2 border-t border-dashed border-border pt-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className={
            expanded
              ? 'rounded-md bg-muted px-3 py-1.5 text-xs text-foreground'
              : 'rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted'
          }
        >
          Snooze
        </button>
      </div>
      {expanded && (
        <div className="-mx-3 -mb-3 mt-1 rounded-b-md border-t border-dashed border-border bg-muted/40 px-3 py-3">
          <h4 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">
            Snooze until
          </h4>
          <input
            type="datetime-local"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:ring-2 focus:ring-ring"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background"
            >
              Snooze
            </button>
          </div>
        </div>
      )}
    </article>
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
