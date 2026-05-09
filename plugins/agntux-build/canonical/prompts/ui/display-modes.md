# Display Modes

## Display Modes (Summary)

**Available Modes:**
- **Inline**: Default, appears directly in conversation flow before model response
- **Fullscreen**: Immersive experiences for complex workflows -- data tables, forms, dashboards
- **PiP (Picture-in-Picture)**: Persistent floating window for ongoing sessions

**Key Rules:**
- Choose ONE primary display mode per component
- Inline: quick confirmations, status summaries, simple actions
- Fullscreen: enterprise workflows with data tables, multi-step forms, dashboards
- PiP: live monitoring, ongoing collaboration sessions

**Fullscreen is an enhancement, not an escape hatch.** `requestDisplayMode('fullscreen')` is available as an opt-in "Expand" affordance for data-dense dashboards, long-form editing, or multi-pane workflows. It is NEVER the fix for a modal, form, or layout that doesn't fit inline at 600px. Every feature must remain fully usable at 600px via internal scrolling regardless of the primary display mode.

## Display Modes

**Inline:**
- Appears directly in conversation flow, before model response
- Default display mode
- **Viewport budget: host gives the iframe ~400–600px of height** (see `hostContext.containerDimensions.maxHeight`). Treat 600px as the target design height; the component MUST remain fully usable at that height with nothing clipped.
- **Scroll, don't clip.** The root container owns its own vertical scroll (`h-full overflow-y-auto`, or wrapped by `InlineLayout`/`WidgetLayout` with `maxHeight` threaded through from `viewport.height`). Never rely on the host to grow the iframe.
- Best for: quick confirmations, simple actions, status summaries, small structured data, and any feature whose core interaction still fits (with internal scrolling) inside 600px
- Can contain action buttons, compact data displays, status cards
- Always appears before model response

**Inline Viewport Budget — Banned Patterns (inline & inline-card only):**
1. `min-h-screen`, `h-screen`, `100vh`, `100dvh` on any container — they assume the iframe is as tall as the browser viewport, which is false.
2. Pixel heights ≥ 560px on modals, panels, or forms — leaves < 40px of iframe chrome and the primary action scrolls off-screen. Use `max-h-[min(560px,calc(100%-2rem))]` instead; the CSS `min()` wrapper clamps below 560 on short viewports.
3. Modals/overlays whose body is not `overflow-y-auto` with a computed max-height — content below the fold is unreachable.
4. Primary action buttons (Submit / Save / Next) that live at the natural bottom of content without being sticky — they scroll off-screen inside the 600px budget.

**Inline Viewport Budget — Required Patterns:**
1. **Scrollable root** — top-level container: `h-full overflow-y-auto`, or `<InlineLayout maxHeight={viewport.height}>`.
2. **Internal scroll + sticky footer** — sticky header + `flex-1 overflow-y-auto` body + sticky footer with the primary action. Use the `<ScrollablePanel>` primitive from `@agntux/ui-primitives` (see `references/ref-scrollable-panel.tsx`). The same primitive serves as the top-level layout for single-view handlers AND as the row-anchored expansion panel for list-view handlers — modals and overlays are forbidden in inline iframes (see `briefing-learnings.md` §2.4 for the retirement record).
3. **Sticky primary actions** — any form/wizard with a submit/next button places it in a `sticky bottom-0` footer inside the scroll container. ScrollablePanel's `footer` prop wires this for you.
4. **Tables** — scroll the tbody (or the whole table wrapper) vertically; sticky `thead` so column headers remain visible as rows scroll.

**Fullscreen is an enhancement, not an escape hatch.** `requestDisplayMode('fullscreen')` stays available for data-dense dashboards or long-form editing as an "Expand" affordance the user can opt into. It is NEVER the fix for a panel or form that doesn't fit inline — that must be fixed at the inline layer. Fullscreen is also the only sanctioned place to render a true blocking overlay; if your handler genuinely needs one, request fullscreen first.

**Fullscreen:**
- Immersive experiences for complex workflows
- Best for:
  - Data tables with sorting, filtering, pagination
  - Multi-step forms and wizards
  - Dashboard layouts with multiple data views
  - Rich editing interfaces
  - Browsing detailed content (listings, records, reports)
  - Any workflow step requiring focused user attention
- Layout:
  - System close button (provided by host)
  - Full content area for your application
  - Composer (the host's native composer, always present)
- Design UX to work with system composer (always present in fullscreen)
- Request via: `useDisplayMode()` hook with "fullscreen" mode

**Picture-in-Picture (PiP):**
- Persistent floating window optimized for ongoing or live sessions
- Best for:
  - Activities that run in parallel with conversation (live dashboards, monitoring)
  - Situations where the widget reacts to chat input (collaborative editing, games)
  - Persistent reference panels during multi-step workflows
- Interaction:
  - Activated: On scroll, PiP stays fixed to top of viewport
  - Pinned: Remains fixed until user dismisses or session ends
  - Session ends: Returns to inline position and scrolls away
- Rules:
  - Ensure PiP state can update when users interact through system composer
  - Close PiP automatically when session ends
  - Note: Coerced to fullscreen on mobile
- Request via: `useDisplayMode()` hook with "pip" mode

**Enterprise Display Patterns:**
- **Data Tables**: Full-width tables with column headers, sortable columns, row actions, pagination. Use fullscreen mode.
- **Multi-Step Forms**: Wizard-style forms with progress indicators, step navigation, validation per step. Use fullscreen mode.
- **Dashboards**: Grid layouts with multiple data cards, charts, and summary statistics. Use fullscreen mode.
- **Detail Views**: Master-detail layouts where selecting an item shows its full details. Use fullscreen mode with navigation.
- **Review Interfaces**: Side-by-side comparisons, approval workflows, annotation tools. Use fullscreen mode.
