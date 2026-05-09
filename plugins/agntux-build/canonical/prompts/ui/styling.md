# Styling

## Styling Approach (Summary)

**Primary Framework:** Tailwind CSS 4 (utility-first)

**Why Tailwind CSS 4:**
- Utility-first approach ideal for building enterprise UIs quickly
- Built-in responsive design utilities
- No component library lock-in -- build exactly what the workflow needs

**Key Patterns:**
- Use Tailwind utilities for all layout, spacing, typography, and color
- Built-in light-mode color system — use semantic Tailwind classes (bg-background, text-foreground, etc.)
- **NEVER use `dark:` variants** — components render light-mode only; there is no dark mode support. Even if the host reports `theme: "dark"`, ignore that signal and render light styles.
- Build custom components as needed -- no library constraints
- Date/time fields MUST use native HTML pickers (`<input type="date">`, `<input type="datetime-local">`, `<input type="time">`) — never free-text inputs or custom calendar popovers
- **Clickable surfaces:** any element with `onClick` that isn't a `<button>` or `<a>` (clickable rows, cards, menu items, tag pills) must set `role="button"` and `tabIndex={0}`. The template's `globals.css` applies `cursor: pointer` to `<button>` and `[role="button"]` automatically, so correctly-marked clickable surfaces inherit the pointer cursor without extra Tailwind classes.

**Structural Colors vs Status Badges (authoritative rule for Section 12 color tables):**

Every container background, body text, default border, and action button MUST resolve through the semantic tokens below. Raw Tailwind palette classes bypass `useHostStyleVariables()` and make the component look identical on every host regardless of theme.

| Structural role        | Good (semantic tokens)                                      | Bad (raw palette)                          |
|------------------------|-------------------------------------------------------------|--------------------------------------------|
| Page / content area    | `bg-background text-foreground`                              | `bg-white text-gray-900`                    |
| Card / panel / modal   | `bg-card text-card-foreground border-border`                 | `bg-white border-gray-200 text-gray-900`    |
| Subtle / muted row     | `bg-muted text-muted-foreground`                             | `bg-gray-50 text-gray-500`                  |
| Primary CTA            | `bg-primary text-primary-foreground`                         | `bg-blue-600 text-white`                    |
| Neutral / secondary    | `bg-secondary text-secondary-foreground`                     | `bg-gray-100 text-gray-700`                 |
| Destructive            | `bg-destructive text-destructive-foreground`                 | `bg-red-600 text-white`                     |
| Form inputs / focus    | `border-input ring-ring`                                     | `border-gray-300 ring-blue-500`             |

**Explicitly forbidden for structural use (any page/card/header/filter-bar/button/modal/form row of the Section 12 color table):** `bg-white`, `bg-gray-*`, `text-gray-*`, `bg-blue-*` (for buttons), `text-blue-*` (for button labels), `bg-black`, `border-gray-*`, `ring-blue-*`.

**Status badges (narrow whitelist — the only place raw palette is allowed):** priority pills, due-date indicators, severity chips, success/warning/error banners. Allowed classes:
- Text: `text-green-600`, `text-green-700`, `text-amber-600`, `text-amber-700`, `text-red-600`, `text-red-700`
- Background: `bg-green-50`, `bg-green-100`, `bg-amber-50`, `bg-amber-100`, `bg-red-50`, `bg-red-100`

Section 12 should split its color table into (1) a **Structural** sub-table using semantic tokens for every row and (2) a clearly labelled **Status badges** sub-table where raw palette classes are permitted.

**Inline Viewport Budget — banned classes (authoritative six-item list):**
`min-h-screen`, `h-screen`, `100vh`, `100dvh`, `100svh`, `100lvh`, plus any raw `max-h-[NNNpx]` ≥ 560 on modals or forms. Modals/forms must use `max-h-[min(560px,calc(100%-2rem))]` so the primary action stays reachable at 600px iframe height.

## Styling Approach: Tailwind CSS 4

**Primary Framework:** Tailwind CSS 4 (utility-first)

**Why Tailwind CSS 4:**
- Utility-first approach enables rapid development of enterprise UIs
- Built-in responsive design utilities for all viewport sizes
- Built-in light-mode color system via CSS variables
- No component library constraints -- build exactly what the business workflow needs
- Consistent spacing, typography, and color scales out of the box
- Tree-shaking removes unused styles for minimal bundle size

**Enterprise UI Patterns with Tailwind:**

- **Data Tables**: Use `table`, `border-collapse`, `divide-y` utilities. Add sorting/filtering with custom React state.
- **Forms**: Use `grid`, `gap`, `space-y` for layout. Style inputs with `border`, `rounded`, `focus:ring` utilities. Dates/times use native pickers (see **Date & Time Inputs** below).
- **Dashboards**: Use CSS Grid (`grid`, `grid-cols-*`) for card layouts. Responsive with `md:`, `lg:` breakpoint prefixes.
- **Navigation**: Use `flex`, `gap`, `border-b` for tab bars. `bg-*` and `text-*` for active states.
- **Buttons**: Use `px-*`, `py-*`, `rounded`, `bg-*`, `hover:bg-*`, `focus:ring` utilities. The template's `globals.css` applies `cursor: pointer` to every `<button>` automatically — no `cursor-pointer` class needed on buttons.
- **Clickable surfaces:** any element with `onClick` that isn't a `<button>` or `<a>` (clickable rows, cards, menu items, tag pills) must set `role="button"` and `tabIndex={0}`. The base CSS rule also targets `[role="button"]`, so correctly-marked clickable surfaces inherit the pointer cursor without extra Tailwind classes.
- **Cards**: Use `rounded-lg`, `shadow`, `p-*`, `border` for card containers.

**Date & Time Inputs — Always Use Native Pickers:**

Every date, time, or datetime field in a workflow component MUST render a native HTML picker. Free-text date entry (`<input type="text" placeholder="MM/DD/YYYY">`) and custom calendar popovers are **forbidden** — users mistype dates, formats are locale-ambiguous, and accessibility regresses.

Use the built-in input types:

| Field type               | Input                              | Value format        |
|--------------------------|------------------------------------|---------------------|
| Date only                | `<input type="date">`              | `YYYY-MM-DD`        |
| Date + time              | `<input type="datetime-local">`    | `YYYY-MM-DDTHH:mm`  |
| Time only                | `<input type="time">`              | `HH:mm`             |
| Month                    | `<input type="month">`             | `YYYY-MM`           |
| Week                     | `<input type="week">`              | `YYYY-Www`          |
| Date range               | Two linked `<input type="date">` fields with `min`/`max` set from each other | each `YYYY-MM-DD` |

**Why native:** Every modern browser renders a real calendar or spinner UI for these inputs, provides locale-aware formatting, keyboard navigation (arrow keys, PageUp/Down), and WCAG-AA focus handling — with **zero dependencies**. Do not install `react-day-picker`, `react-datepicker`, `date-fns`, or any date library; the component template has none, and adding one bloats the bundle.

**State:** Store the input's native ISO string (`YYYY-MM-DD`, `HH:mm`, etc.) directly in React state. Only convert to a `Date` object at display time using `Intl.DateTimeFormat` with the user's locale/timezone (e.g., `toolOutput?.userPreferences?.identity?.timezone ?? 'UTC'`). Never round-trip through `new Date(freeTextString)` parsing.

**Validation:** Use the input's built-in `min`, `max`, `step`, and `required` attributes before reaching for JavaScript validators. Example: `<input type="date" min="2025-01-01" max="2026-12-31" required>`.

**Styling:** Inherit the same border, padding, radius, and focus ring as text inputs — native date inputs accept all the usual CSS. Use the same `.input` class (or Tailwind equivalent: `w-full px-3 py-2 border rounded focus:ring-2 focus:ring-ring`) so date fields visually match the rest of the form.

**Color System (built-in, light mode):**

The component template includes a complete light-mode color system defined in `globals.css`. Use these Tailwind semantic classes:

| Purpose              | Background        | Text                        | Border         |
|----------------------|-------------------|-----------------------------|----------------|
| Page/content area    | `bg-background`   | `text-foreground`           | —              |
| Cards & panels       | `bg-card`         | `text-card-foreground`      | `border-border` |
| Muted/subtle areas   | `bg-muted`        | `text-muted-foreground`     | —              |
| Secondary elements   | `bg-secondary`    | `text-secondary-foreground` | —              |
| Primary actions      | `bg-primary`      | `text-primary-foreground`   | —              |
| Destructive actions  | `bg-destructive`  | `text-destructive-foreground` | —            |
| Input fields         | —                 | —                           | `border-input` |
| Focus rings          | —                 | —                           | `ring-ring`    |

**Color rules:**
- ALWAYS use these semantic Tailwind classes for colors
- NEVER use inline styles with CSS variables (e.g., `style={{ color: 'var(--color-text-primary)' }}`)
- NEVER write `getThemeFallbackCSS` functions or inject `<style>` blocks for theming
- NEVER use `dark:` variants — there is no dark mode support
- The default palette is neutral (zinc) with blue primary. Hosts override these via CSS variables through `useHostStyleVariables()`; only semantic classes inherit those overrides.

**Structural colors (required — semantic tokens, never raw palette):**
Every container background, body text, default border, and action button MUST resolve through the semantic tokens above. Hard-coding raw Tailwind palette classes bypasses the host-theming plumbing that `useHostStyleVariables()` sets up.

| Good (semantic) | Bad (raw palette) |
|---|---|
| `bg-background text-foreground` (page) | `bg-white text-gray-900` |
| `bg-card text-card-foreground border-border` (panel) | `bg-white border-gray-200 text-gray-900` |
| `bg-muted text-muted-foreground` (subtle row) | `bg-gray-50 text-gray-500` |
| `bg-primary text-primary-foreground` (CTA) | `bg-blue-600 text-white` |
| `bg-secondary text-secondary-foreground` (neutral button) | `bg-gray-100 text-gray-700` |
| `bg-destructive text-destructive-foreground` (danger) | `bg-red-600 text-white` |
| `border-input ring-ring` (form controls) | `border-gray-300 ring-blue-500` |

Explicitly forbidden for structural use: `bg-white`, `bg-gray-*`, `text-gray-*`, `bg-blue-*` (for buttons), `text-blue-*` (for button labels), `bg-black`, `border-gray-*`, `ring-blue-*`. These classes do not track the host's color variables and will make the component look identical on every host regardless of theme.

**Status-only raw palette (narrow whitelist — badges/indicators only):**
Status, severity, and priority indicators MAY use Tailwind's built-in semantic palette because the meaning ("red = danger", "green = success") should stay constant across themes. Allowed classes:
- Text: `text-green-600`, `text-green-700`, `text-amber-600`, `text-amber-700`, `text-red-600`, `text-red-700`
- Background: `bg-green-50`, `bg-green-100`, `bg-amber-50`, `bg-amber-100`, `bg-red-50`, `bg-red-100`

These are reserved for priority pills, status chips, and inline warnings. Do NOT use them for page backgrounds, card surfaces, or default buttons.

**Scroll Containers & Sticky Actions (required for the 600px inline budget):**

Inline iframes are ~400–600px tall (`hostContext.containerDimensions.maxHeight`). Features must scroll inside their own container, not the host chrome. Use these exact patterns:

**Scrollable root** — every inline component starts with this:
```tsx
<div className="h-full overflow-y-auto bg-background">
  {/* content */}
</div>
```

Or, when using `<InlineLayout>` / `<WidgetLayout>`, thread the host-provided height through:
```tsx
<InlineLayout maxHeight={viewport.height}>{/* content */}</InlineLayout>
```

**Internal-scroll modal** — sticky header + scrollable body + sticky footer, capped at 560px so the primary action is always reachable:
```tsx
<div className="fixed inset-0 bg-foreground/40 flex items-center justify-center p-4">
  <div className="w-full max-w-md max-h-[min(560px,calc(100%-2rem))] bg-card border border-border rounded-lg flex flex-col">
    <header className="sticky top-0 px-5 py-3 border-b border-border bg-card">Title</header>
    <div className="flex-1 overflow-y-auto p-5">{/* body */}</div>
    <footer className="sticky bottom-0 px-5 py-3 border-t border-border bg-card flex justify-end gap-2">
      <button type="button">Cancel</button>
      <button type="submit" className="bg-primary text-primary-foreground">Save</button>
    </footer>
  </div>
</div>
```
Prefer the `<ScrollablePanel>` primitive from `@agntux/ui-primitives` over hand-rolling this. ScrollableModal is retired — modals are forbidden in inline iframes (see `briefing-learnings.md` §2.4); ScrollablePanel is the non-modal layout that ships the same sticky-header / scroll-body / sticky-footer shape.

**Sticky form actions** — primary action always reachable inside the scroll container:
```tsx
<form className="h-full overflow-y-auto">
  <div className="p-4 space-y-4">{/* fields */}</div>
  <footer className="sticky bottom-0 bg-background border-t border-border p-3 flex justify-end gap-2">
    <button type="submit" className="bg-primary text-primary-foreground">Save</button>
  </footer>
</form>
```

**Scrollable table with sticky header** — column headers remain visible as rows scroll:
```tsx
<div className="h-full overflow-y-auto">
  <table className="w-full">
    <thead className="sticky top-0 bg-background border-b border-border">…</thead>
    <tbody className="divide-y divide-border">…</tbody>
  </table>
</div>
```

**Banned in inline/inline-card:** `min-h-screen`, `h-screen`, `100vh`, `100dvh`, `100svh`, `100lvh`, any raw `max-h-[\d+px]` ≥ 560px on modals or forms (use the `min(560px,calc(100%-2rem))` pattern instead), modals/popovers without an internal `overflow-y-auto` body, submit buttons not in a sticky footer.

**Best Practices:**
- Use Tailwind utilities as the primary styling approach
- Create reusable React components (not CSS class abstractions) for repeated patterns
- Use semantic Tailwind classes for all colors (bg-background, text-foreground, bg-primary, etc.)
- Responsive design: mobile-first with `sm:`, `md:`, `lg:` breakpoints
- Accessibility: use `sr-only` for screen-reader text, `focus-visible:` for focus styles

**oklch Colors:**
Tailwind CSS 4 generates default palette colors (e.g., `bg-blue-100`, `text-green-600`) using `oklch()` color functions. Modern browsers support oklch natively — no special handling needed for rendering.

**Note:** `html2canvas` cannot parse oklch colors. However, PDF generation and file downloads are NOT currently supported in MCP Apps (blocked by iframe sandbox). Do not use html2canvas, jsPDF, or any PDF/file generation libraries in components.
