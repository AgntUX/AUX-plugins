# UI designer discipline

Behavioural rules for any agent producing the static `ui-design.html`
prototype for an AgntUX plugin's UI handler. Distilled from a prior
production ui-designer-agent prompt and adapted for the
`agntux-plugin-dev` toolkit. The rules below cover the **design
artifact** that lives alongside the React component; the per-plugin
workflow (when to design, who reviews) is owned by `ui-handler-author`.

## Output

A single file at
`plugins/{slug}/ui-handlers/{name}/component/ui-design.html`. The
component author reads this as the visual reference when implementing
`src/components/main-component.tsx` — it is the contract between design
and component-code lanes.

## File-naming rules — the Single File Rule

There is ONLY ONE valid design file per UI handler: **ui-design.html**.

Forbidden filenames (silently break the workflow downstream):

- `ui-design-v2.html`
- `ui-design-clean.html`
- `ui-design-fixed.html`
- `ui-design-updated.html`
- ANY other variation

When fixing errors:
1. Read the current `ui-design.html`.
2. Make targeted edits in place.
3. Re-screenshot or re-validate.
4. Repeat until correct/valid.

Do NOT delete `ui-design.html` and create a new one. Do NOT create a
"clean" version — diff history lives in git.

## Workflow — single session, in order

1. **Read context** — the plugin's `marketplace/listing.yaml` `ui_components` entry whose `name` matches the handler being designed (its `purpose` field is your behavioral brief), the spec's UI/UX guidelines (if a spec exists), and the relevant rows of `briefing-learnings.md` Section 1.
2. **Read shared design references selectively** — only the ones relevant to the surface you're designing. Don't read everything.
3. **Write the design** to `ui-design.html`. For files under ~300 lines, write the entire file in one pass. For larger files, scaffold-then-fill: write the CSS-token block + page structure + `<!-- TODO: section name -->` placeholders first, then make 2–4 large edits to fill each section.
4. **Screenshot review** — render at desktop (1280×720) and mobile (375×667). Visually inspect both screenshots end-to-end before declaring done.
5. **HTML validation** — confirm the markup parses and validates with no errors.
6. **Hand off** — present the completed design with a short pass/fail note for each of the six self-review checks below. The downstream coder lane (`ui-handler-author` §4) MUST walk through the rendered design with the developer in the browser and pause for explicit feedback before scaffolding the React component — your handoff note is the input to that gate, not a substitute for it.

## MUST

- Work on ONE UI handler at a time as specified.
- Use the EXACT plugin slug and handler name from the task description.
- Create HTML/CSS only — NO JavaScript/React (the coder lane writes those).
- Design responsively to work across all viewport sizes.
- Show at least one item in its "success/completed" state alongside pending items.
- Every trigger that opens an interactive surface (modal, drawer, inline form, draft panel, confirmation micro-surface, undo toast) MUST render AT LEAST ONE example of the OPENED state in the static HTML alongside the idle trigger.
- Components with state-dependent layouts (focus mode State A vs B, populated vs empty, expanded vs collapsed accordion, before/after a triage pass) MUST render BOTH states.
- Every component MUST render at least one bootstrap-period empty-state example (first hours/days/week after install). Tone: reassuring.
- Every design MUST include action buttons for write-back operations.
- Every write-back maps to a `sendFollowUpMessage()` call in the coder's React implementation.

## NEVER

- NEVER refer to file paths, code, or technical details in user-facing messages.
- NEVER include host app elements (prompts, messages, navigation, host UI chrome).
- NEVER use `<a href>` tags for external URLs — they do NOT work in the iframe sandbox. Use `<button>` styled as link; the coder will wire `useAppsClient().openLink()` per `briefing-learnings.md` §1.7.
- NEVER use raw color hex codes outside the CSS design token block (use CSS variables defined in the template).
- NEVER use free-text date inputs — always use native HTML pickers (`<input type="date">`, `datetime-local`, `time`).
- NEVER build a custom calendar popover or install a date library.
- NEVER use `min-h-screen`, `h-screen`, `100vh`, `100dvh` on any container — the iframe is not the browser viewport.
- NEVER design modals/panels/forms with pixel heights ≥ 560px.
- NEVER place primary action buttons (Submit, Save, Next, Confirm) at the natural bottom of a tall content block without making them sticky.
- FORBIDDEN bootstrap empty-state words: "failed", "error", "no results", unqualified "no data".
- NEVER silently omit a shared element. Either render verbatim or render a NOT APPLICABLE comment with justification — silent omission is rejected at self-review.

## Always

- Always use system fonts (SF Pro, Roboto) — Tailwind CSS 4 with system defaults.
- Always use rem/em units (not px) to support text resizing for accessibility.
- Always use semantic HTML elements.
- Always provide ARIA labels for all interactive elements.
- Always provide descriptive alt text for all images.
- Always design for keyboard-only navigation with visible focus indicators and logical tab order.
- Always support text resizing up to 200% without breaking layouts.
- Always maintain WCAG AA contrast ratios.
- Always use `<button>` elements styled as links instead of `<a>` tags for external URLs (the coder will wire them with the host's `openLink()` API). Add ↗ arrow or external-link icon.
- For dialogs/drawers/modals: add an HTML comment near the element documenting intended focus-trap and Escape-closes behavior (the coder implements per `briefing-learnings.md` §1.11).

## Shared elements (multi-component workflows)

When the spec describes UI that applies to MULTIPLE components (a global header, persistent tab strip, learning-transparency drawer, keyboard-shortcut help overlay, auto-learn banner, system-wide confirmation micro-surface, etc.), that markup is SHARED. Every ui-design.html in the workflow MUST render each shared element with IDENTICAL markup so the coder can lift it into a single React component.

**Sentinel convention** — wrap every shared element with a SHARED comment so the coder can grep for it across sibling component designs:

```html
<!-- SHARED: learning-transparency-drawer. This exact markup must appear
     in every sibling component's ui-design.html. Do not alter without
     coordinating across all designs in this workflow. -->
<div class="learning-drawer" role="dialog" aria-modal="true" aria-labelledby="learning-title">
  ...
</div>
<!-- /SHARED: learning-transparency-drawer -->
```

If a shared element is genuinely not applicable to this specific component (e.g., a "compose" overlay on a read-only dashboard), document the exception explicitly:

```html
<!-- SHARED: auto-learn-banner NOT APPLICABLE here because this component is read-only and never triggers a learning event. -->
```

## Action feedback states (REQUIRED for every write-back action)

For each write-back action button, the design MUST show all four states:

- **Default state**: button at rest, enabled.
- **Loading state**: button with spinner icon and/or disabled appearance.
- **Success state**: how the item/card looks AFTER success — show status badge change (e.g., amber "Pending" → green "Replied"), confirmation text, visual de-emphasis (reduced opacity or moved to "handled" section).
- **Error state**: inline error message near the failed action (red text below the action area, button re-enabled for retry).

Label specifically: "Update Stage", "Mark Complete", "Assign to..." — not generic "Submit". Visually distinguish write-backs (primary style) from UI-only interactions (ghost/outline).

## Rendering interactive surfaces — anti-patterns

Each is a correctness risk, not stylistic:

- A "Challenge" / "Reply" / "Ping" button with NO draft panel rendered beneath or beside it — the coder may autosend the generated text.
- An "Add to To-Do" / "Add comment" / "New task" button with NO inline form rendered — the coder may invent the wrong fields.
- A clickable header indicator with NO drawer/modal shown OPENED anywhere — the coder may leave it as dead UI.
- An accordion/expandable list rendered ONLY in collapsed state — the coder may forget to implement expansion.
- A focus-mode design showing ONLY State A — the coder cannot infer State B's layout, copy, or per-item actions.
- An auto-detected item with a "new" badge and NO dismiss / "not a commitment" affordance shown — the coder may render the badge without the dismiss path.

## Conditional visibility (REQUIRED)

When an element's visibility is conditional, EXPRESS the conditionality in the static HTML via ONE of:

- A `data-render-when="{condition}"` attribute plus a brief explanatory comment:
  ```html
  <!-- Tier rendered only when it has at least one item; hide when empty per spec UI/UX. -->
  <section data-render-when="tier.items.length > 0" class="tier-section">...</section>
  ```
- An HTML comment immediately preceding the block: `<!-- Rendered only when {condition} -->`
- Paired examples (e.g., populated tier + empty tier side-by-side, with labels)

**Spec triggers that REQUIRE a conditionality marker:** "hidden when empty", "only when state X", "expanded by default for {priority}", "appears only if {predicate}", "shown after the {N}-day bootstrap", "collapsed unless".

Silent always-visible markup where the spec implies conditional rendering is rejected at self-review.

## Per-element accessibility checklist (MANDATORY)

| Element type | Required attributes / pattern |
|---|---|
| Icon-only buttons (no visible text label) | `aria-label="{action description}"` REQUIRED |
| Loading-state buttons | `aria-busy="true"` while loading; remove (or set `false`) on success/error |
| Time displays | `<time datetime="{ISO 8601}">…</time>` — never bare strings like "3 hours ago" |
| Date inputs | `<input type="date">` — no custom date picker markup |
| Datetime inputs | `<input type="datetime-local">` |
| Time-only inputs | `<input type="time">` |
| Dialogs / drawers / modals | `role="dialog"` + `aria-modal="true"` + `aria-labelledby="{id-of-title}"` |
| Live regions for per-item action status | `aria-live="polite"` on the status text container |
| Form labels | `<label for="{input-id}">` OR wrap the input — never visually-only |
| Focus rings | Visible `:focus-visible` outline on every interactive element |

**Keyboard handling annotations** — for each dialog/drawer container, add an HTML comment near the element documenting intended focus-trap and Escape-closes behavior, e.g.:

```html
<!-- Behavior for coder: trap focus inside this dialog while open;
     Escape closes; restore focus to the trigger button on close. -->
<div role="dialog" aria-modal="true" aria-labelledby="learning-title">…</div>
```

The coder is responsible for implementation; the comment is the contract.

## Inline viewport budget — 600px tall, scroll, don't clip

The host gives inline/inline-card iframes ~400–600px of height. Every design MUST remain fully usable at 600px tall.

**Banned in inline/inline-card designs:**
1. `min-h-screen`, `h-screen`, `100vh`, `100dvh` on any container.
2. Modals, panels, or forms with pixel heights ≥ 560px. Use `max-h-[min(560px,calc(100%-2rem))]`.
3. Modals/dialogs/overlays without an `overflow-y-auto` body and a capped max-height.
4. Primary action buttons sitting at the natural bottom of a tall content block without being sticky.

**Required in every inline/inline-card design:**
1. **Scrollable root** — top-level container is `h-full overflow-y-auto`.
2. **Internal-scroll modals** — sticky header + `flex-1 overflow-y-auto` body + sticky footer with primary action. Max height capped at `min(560px, 100% - 2rem)`.
3. **Sticky primary actions** — any form/wizard/long list places the primary action in a `sticky bottom-0` footer inside the scroll container.
4. **Sticky table headers** — data tables use sticky `<thead>`.
5. **Fullscreen as enhancement, not escape hatch** — `requestDisplayMode('fullscreen')` may be offered as opt-in "Expand" affordance on dense views, but NEVER the workaround for an inline modal/form that doesn't fit.

**Screenshot test:** review at 1280×720 AND 400×600. Verify modal, primary CTA, and any wizard step are reachable via internal scroll at 400×600 with no clipping.

## Bootstrap / Day-1 empty states (REQUIRED)

Every component MUST render at least one empty-state example representing the bootstrap period — first hours/days/week after install, when the system has no data yet.

**Tone: reassuring.** The user has just installed the app and is judging whether it works.

- FORBIDDEN words/phrases: "failed", "error", "no results", unqualified "no data".
- REQUIRED tone: "We're listening", "We'll have your first {thing} soon", "Nothing yet — we'll flag the moment something arrives", "You're all set — we'll start showing items as they come in".
- If the workflow has a learning indicator or observation period, pair the bootstrap empty state with a status badge (e.g., "Observing — first 7 days").

**Post-action zero states** (e.g., "Inbox zero — nice work", "All caught up") may have a celebratory tone and should be visually distinct.

## External links (sandbox constraint)

MCP Apps run in sandboxed iframes — standard `<a href>` tags do NOT work for external URLs.

- Use `<button>` elements styled as links instead of `<a>` tags. Reset default button chrome:
  ```css
  .link-btn { background: none; border: none; color: var(--color-blue-600); cursor: pointer; padding: 0; font: inherit; }
  .link-btn:hover { text-decoration: underline; }
  ```
- Add a ↗ arrow or external-link icon.
- The coder will wire these up with the host's `openLink()` API.

## Display mode selection

- **Fullscreen**: preferred for most enterprise workflow UIs (dashboards, data tables, forms, wizards).
- **Inline Card**: quick data summaries, status overviews, lightweight widgets.
- **PiP**: real-time monitoring, ongoing sessions.

Match the display mode to the workflow's needs.

## Responsive breakpoints

- **Mobile (320px - 480px):** screenshot test viewport 375×667. Single-column layouts. Touch-friendly tap targets (min 44px).
- **Tablet (481px - 1024px):** two-column layouts possible. Maintain generous touch targets.
- **Desktop (1025px+):** screenshot test viewport 1280×720. Multi-column layouts where appropriate.

**Do NOT use overly restrictive max-width values:**
- ❌ `max-width: 400px` — Too narrow, wastes desktop space
- ❌ `max-width: 500px` — Still too restrictive
- ✅ `max-width: 600px-800px` — Acceptable for card-style content
- ✅ `max-width: 100%` with padding — Allows content to breathe
- ✅ No max-width with `width: fit-content` — Sizes to content naturally

A design that looks good at 375px but stays that narrow at 1280px is a poor desktop experience.

## Design excellence — within platform constraints

**Typography mastery (system fonts):**

| Generic | Intentional |
|---------|-------------|
| 1rem regular everywhere | 1.75rem bold headline / 0.875rem regular body / 0.75rem light caption |
| Same weight for all text | Bold for emphasis, regular for content, light for secondary |
| Default line-height | Tight headlines (1.1-1.2), generous body text (1.5-1.6) |
| Default letter-spacing | -0.02em on large text, +0.05em on small caps |

**Color with intention:**

| Generic | Intentional |
|---------|-------------|
| Gray everything with weak blue accent | High-contrast text with one bold accent on primary CTA |
| Multiple competing accent colors | Single accent color, used only where action is needed |
| Low-contrast, washed-out palette | Confident contrast ratios, decisive color choices |

**Spatial craft:**

| Generic | Intentional |
|---------|-------------|
| 0.5rem margins everywhere, cramped | 1.5rem+ breathing room, generous padding |
| Everything same size | One hero element at 2-3x scale, supporting content smaller |
| Loose alignment | Precise alignment on a consistent grid |
| Equal spacing between all elements | Tight grouping within sections, generous space between |

## Editing efficiency anti-pattern

DO NOT:
- Read small chunks (10-50 lines) and edit incrementally.
- Make dozens of small targeted edits instead of a few large ones.
- Read the file after every single small edit.
- Use offset/limit when reading a file you're about to edit.

This incremental approach is 10x slower and more expensive. Always read the full file, then make large consolidated edits. Scaffold-then-fill (1 write + 2–4 large edits) is NOT this anti-pattern — it is a structured approach to avoid output token truncation on large files.

## Circuit breaker

After 3 consecutive failures producing the SAME error on the SAME tool:
1. STOP retrying immediately.
2. Surface "PERSISTENT ERROR: [tool_name] failed 3 times with: [error]. Unable to resolve." to the orchestrator.
3. Do NOT continue with other work — report and stop.

## Self-review — blocker checks

Before presenting the UI design:

- **Screenshot Review** — viewports rendered at 1280×720 AND 375×667; both inspected end-to-end.
- **HTML Validation** — markup parses without errors.
- **File Naming** — Design is at `ui-design.html`, NO alternative filenames.

## Self-review — six MANDATORY checks (explicit pass/fail required)

For each, write a brief pass/fail note in handoff. If any check fails, halt, fix, re-run before presenting.

1. **Shared elements presence** (multi-component workflows). For each shared element identified from spec's UI/UX or design-guidelines, verify either it appears wrapped in `<!-- SHARED: {name} -->` … `<!-- /SHARED: {name} -->` sentinel pair, OR an explicit `<!-- SHARED: {name} NOT APPLICABLE because {reason} -->` exemption is present. Single-component workflows: mark N/A.
2. **Interactive surface states.** Grep for every button/trigger labeled with verbs that open interactive surfaces (Challenge, Add, Edit, Reply, Ping, Renegotiate, Configure, Expand, Open, Draft, Compose, Schedule, Assign, Snooze). For each, verify at least one example of the OPENED state renders alongside it.
3. **Conditional visibility markers.** Cross-reference spec's UI/UX for phrases implying conditional rendering. Verify each has a `data-render-when` attribute, an explanatory `<!-- Rendered only when … -->` comment, OR a paired example.
4. **Per-element accessibility.** Confirm every required attribute from the per-element checklist.
5. **Day-1 empty state.** Confirm at least one bootstrap-period empty-state example with reassuring tone and none of the FORBIDDEN words.
6. **Spec action-affordance coverage.** For every row in spec's Section 5 (User Interactions) that applies to THIS component, confirm a visible affordance exists. Common gaps: "dismiss", "not a commitment", "snooze", "defer", "resolve", "respond now", state-B-only actions.

## Inline viewport self-review additions

- Every modal/overlay has a capped max-height and scrollable body.
- Every primary action is reachable at 600px viewport without relying on the host to grow the iframe.
- Zero uses of `min-h-screen`, `h-screen`, `100vh`, `100dvh` anywhere in the HTML.
- If `requestDisplayMode('fullscreen')` is offered, it is an optional enhancement with a working inline fallback.
