# Coder discipline

Behavioural rules for any agent generating MCP App component code in
an AgntUX plugin's `ui-handlers/{name}/component/` directory. Distilled
from a prior production coder-agent prompt and adapted for the
`agntux-plugin-dev` toolkit. The rules below are about the **code the
component contains** — the per-plugin scaffold sequence (when to copy
which template, when to run which build) is owned by `ui-handler-author`
and the canonical `_template/` README; this file does not duplicate it.

## What you write

You author code only inside one directory:

- `plugins/{slug}/ui-handlers/{name}/component/src/components/main-component.tsx`
- `plugins/{slug}/ui-handlers/{name}/component/src/components/*.tsx` (extracted siblings)
- `plugins/{slug}/ui-handlers/{name}/component/src/lib/*.ts` (project-specific helpers)
- `plugins/{slug}/ui-handlers/{name}/component/src/__tests__/**/*.tsx`
- `plugins/{slug}/ui-handlers/{name}/component/locales/en-US.json`

You do **not** modify: `package.json`, `package-lock.json`, `tsconfig*.json`,
`vite.config.ts`, `vitest.config.ts`, `tailwind.config.mjs`, `src/main.tsx`,
`src/App.tsx`, `src/lib/apps-react/*`, `src/lib/apps-client/*`, or anything
under `src/lib/safe-accessors.ts` (other than adding new helpers). Those
are owned by the canonical `_template/` and should arrive byte-for-byte.

## MUST

- All container/text/border classes MUST resolve through the semantic token system (`bg-background`, `bg-card`, `bg-primary`, `text-foreground`, `text-muted-foreground`, `border-border`, etc.) so `useHostStyleVariables()` can retheme the component on each host. Raw Tailwind palette classes (`bg-white`, `bg-gray-*`, `text-gray-*`, `bg-blue-*`) are reserved for status badges — never used for page, card, or button surfaces.
- Implement progressive rendering via `useOnToolInputPartial` (already wired in `App.tsx`) — skeletons gate on `hasAnyRenderableData`, not on `!toolOutput`.
- Every component MUST implement a single `parsePayload(toolOutput)` (or equivalent) that returns a fully-defaulted view-model handling three envelope shapes uniformly:
  - Shape A: `{ _meta: { payload: {...} } }` (canonical relay envelope AND synthesized streaming shape)
  - Shape B: Flat `structuredContent` at top level
  - Shape C: Empty / pre-first-partial: `{}` or `undefined`
- Every interactive element rendered in JSX MUST have a functioning handler. Forbidden: `onClick={() => {}}`, `onSubmit={() => {}}`, `onChange={() => {}}` — empty arrow functions on any event handler.
- Every interactive element MUST have a `data-testid` attribute. Naming: `{action}-{context}` (e.g., `share-send-btn`, `tab-${tabName}`).
- Every user-visible string MUST trace to one of: a stable design source the developer pinned, runtime user-supplied value from `toolOutput`, or `locales/en-US.json`.
- Every user action that triggers `sendFollowUpMessage` or `callTool` MUST implement the full lifecycle: **idle → loading → success | error**.
- Every `sendFollowUpMessage` MUST end with: "Do not add any commentary after completing the update."
- Use the sigil envelope (`@key:value`) and `inline()`/`block()` helpers when embedding user text in `sendFollowUpMessage`. Quoted-string interpolation (`title='${data.title}'`) is forbidden.
- For `tool-input-partial` notifications, treat each partial as the FULL current args object (not a delta).

## NEVER

- Never call `callTool('{slug}_read_file', …)` or any other built-in file tool from the component. They are HOST-ONLY.
- Never call `callTool('{slug}_send_email', ...)` from the component. Email goes through `sendFollowUpMessage` (compound action).
- Never call your own rendering/view tools from inside the component (does not trigger re-render or update `toolOutput`; circular).
- Never create custom stateful plugin render tools (`callTool('update_talking_points', ...)`, `callTool('save_preferences', ...)`). Plugin render tools are stateless relay data transformers.
- Never use `<a href>` tags, `window.open()`, `location.href`, data URLs, or blob URLs for external links — they silently fail in the iframe sandbox. Use `client.openLink(url)` (HTTPS only).
- Never use `mailto:` or `tel:` — present email/phone as copyable text.
- Never call `new Date()`, `Date.now()`, or `toISOString()` to synthesize a value the host will write. Host-authored fields (`completedAt`, `createdAt`, `updatedAt`, anything ending `At`/`_at`/`_ts`, IDs returned by compound actions like Jira keys, Slack TS, HubSpot record IDs) stay `undefined` in local state until next render hydrates from `toolOutput`.
- Never store sensitive data in `widgetState` (passwords, API keys, secrets, PII).
- Never modify the canonical-locked files (`package-lock.json`, `src/lib/apps-react/`, `src/lib/apps-client/`, `src/App.tsx`, `src/main.tsx`, `vite.config.ts`).
- Never refer to file paths, code snippets, or technical implementations in user-facing messages. Reference deliverables by purpose: "Your workflow", "The interface".
- Never use `min-h-screen`, `h-screen`, `100vh`, `100dvh`, `100svh`, `100lvh` anywhere in the component. The iframe is not the browser viewport.
- Never render an `<input value={data.x}>` outside a `disabled={isStreaming}` fieldset — partials clobber user input.

## Always

- Always read the full file before editing — make large consolidated edits, not many small ones.
- Always use scaffold-then-fill (1 write + 2-4 large edits) for files over ~300 lines to avoid output-token truncation.
- Always wrap the primary interactive region in `<fieldset disabled={isStreaming} className="contents">` so partials don't clobber user input.
- Always show a non-blocking streaming indicator: `sticky top-2 right-2` pulsing-dot chip, `role="status"`, `aria-live="polite"`, `aria-busy="true"` on the root scroll container. Users must still be able to READ the progressively-rendered content.
- Always default arrays to `[]`, objects to `{}` (or typed default), strings to `''`, numbers to `0`, booleans to `false`, dates to `undefined`.
- Always derive `key` from a stable field with fallback (`x.id ?? fallbackIndex`).
- Always access nested fields defensively (`x.channel?.name ?? ''`).
- Always read preferences from `useToolResult()` — `userPreferences` (identity + shared_behavior + profile) and `appPreferences` (ui_defaults + behavior + onboarding). Apply sensible defaults (UTC timezone, `false` for booleans).
- Always seed `widgetState` from `appPreferences.ui_defaults` on mount for every persistable-default control row.
- Always wire write-back actions via `sendFollowUpMessage` for third-party connectors and built-in `{slug}_send_email`/`{slug}_*_file` tools.
- Always use `callTool(name, args)` only for own-server CUSTOM (stateless) tools.
- For each expansion panel (the canonical layout — `<ScrollablePanel>` from `@agntux/ui-primitives`): sticky header + `flex-1 overflow-y-auto` body + sticky footer. The primitive caps body height to its parent and the parent caps to `min(560px, calc(100% - 2rem))` when needed (the iframe is already height-bounded). **Modals are forbidden in inline iframes** (see `briefing-learnings.md` §2.4) — use the inline expansion panel pattern instead.
- For long forms/wizards: place the primary action in a `sticky bottom-0` footer inside the scroll container.
- Root container is `h-full overflow-y-auto` or wrapped by `<InlineLayout maxHeight={viewport.height}>`.
- Data tables use sticky `<thead>`.

## Sigil envelope examples (good vs bad)

```ts
// GOOD (sigil envelope, matches the file schema)
await sendFollowUpMessage(
  `User created a new task. Prepend to tasks.md:\n` +
  `@id:${newId} @workstream:${ws} @priority:${p} @due:${d} ${inline(title)}\n` +
  (description ? `${block(description)}\n` : ``) +
  `Do not add any commentary after completing the update.`
);

// GOOD (dismiss, no user text)
await sendFollowUpMessage(
  `The user dismissed ticket ENG-42. Call {slug}_prepend_file with path 'handled.md' and content 'ENG-42\n'. Do not add any commentary after completing the update.`
);

// BAD (quoted-string interpolation — breaks on apostrophes/newlines)
await sendFollowUpMessage(
  `User created task: title='${data.title}', description='${data.description}'. Do not add any commentary after completing the update.`
);
```

## Optimistic state — single-writer discipline

```ts
// GOOD — leave host-authored fields undefined
setTasks(prev => prev.map(t => t.id === id ? { ...t, done: true, completedAt: undefined } : t));
await sendFollowUpMessage(`User marked @id:${id} done. Flip "- [ ]" to "- [x]" on that line and add @completed with today's date. Do not add any commentary after completing the update.`);

// BAD — component and host both stamp the date
const today = new Date().toISOString().split('T')[0];          // drifts vs host's clock
setTasks(prev => prev.map(t => t.id === id ? { ...t, done: true, completedAt: today } : t));
```

## Write-back pattern — callTool vs sendFollowUpMessage

| Scenario | Method | Example |
|---|---|---|
| Custom own-server tool (stateless render transform) | `callTool('tool_name', args)` | Refresh data, local computations |
| Built-in file or email tool (`{slug}_read_file`, `{slug}_send_email`, …) | `sendFollowUpMessage` — never `callTool` | Host-only |
| Write back to a third-party service | `sendFollowUpMessage('descriptive message')` | HubSpot deal, Jira issue, Asana task |
| State change in third-party (mark read, archive, dismiss) | `sendFollowUpMessage('Mark/archive/dismiss...')` | Acknowledge alert |

## Email tool — host-only, built-in

The `{slug}_send_email` tool is on every plugin's MCP server, but **the component must NEVER call it directly.** The only pattern — component asks host to draft and send (compound action):

```ts
const handleEmailSummary = async () => {
  setWidgetState(prev => ({ ...prev, emailSending: true }));
  try {
    await sendFollowUpMessage(
      `Send an email to ${recipientEmail} with subject "Weekly Summary" containing a formatted summary of the data currently displayed. ` +
      `Format the email with clean, professional HTML: use a simple single-column layout, a neutral color palette (dark text on white background), clear section headings, and a brief sign-off. Keep it concise and scannable.`
    );
  } finally {
    setWidgetState(prev => ({ ...prev, emailSending: false }));
  }
};
```

## Self-review grep (expected matches in `src/components/**/*.tsx`)

| Pattern | Expected | Why |
|---|---|---|
| `.map(` | every match preceded by `?? []` or `Array.isArray(` | `.map` on undefined throws |
| inline `toolOutput?.` chained without `??` | 0 | Defensive parse happens once in `parsePayload` |
| `new Date().toISOString` | 0 | Host-authored timestamps only |
| `onClick={() => {}}` | 0 | No dead handlers |
| function `parsePayload` or `parseToolOutput` | ≥1 | Mandatory defensive helper |
| `useOnToolInputPartial` import in `App.tsx` | 1 | Progressive rendering is default |
| `<fieldset disabled={isStreaming}` OR equivalent guard | ≥1 | Read-only during streaming |
| `<input value={data.` | 0 outside a fieldset-disabled subtree | Streaming inputs must be disabled |
| `Lorem|Placeholder|Coming soon|Default text|Your content here|Under construction` in `*.tsx` and `locales/*.json` | 0 | No placeholder copy in user-visible content |
| `() => {}` in component `*.tsx` | 0 | No empty handlers |
| `min-h-screen|h-screen|h-\[100vh\]|100dvh|100vh` in `src/` | 0 | Component must remain usable in 600px iframe |

## 3-Strike failure rule (code errors only)

If the SAME error persists after 3 fix attempts:
1. STOP retrying this ticket.
2. Append a failure note to your progress log, including the error and what was tried.
3. Surface the failure to the orchestrator.
4. Skip to the next concern — do not stop your entire session.

## Infrastructure errors — stop immediately

Stop retrying and surface immediately when you see:
- "Access denied" or "Forbidden" — API permission/authorization issue
- "CIRCUIT BREAKER" — already failed too many times with the same error
- "not configured" or "API key" errors — missing environment configuration
- HTTP 401/403 from any API
- "ECONNREFUSED" or DNS resolution failures

These require human intervention. Do NOT retry, do NOT try different parameters.

## Per-element accessibility checklist (mandatory)

| Element type | Required attributes / pattern |
|---|---|
| Icon-only buttons (no visible text label) | `aria-label="{action description}"` REQUIRED |
| Loading-state buttons (and ALL siblings disabled by same flag) | `aria-busy="true"` while loading; remove on success/error |
| Time displays | `<time dateTime="{ISO 8601}">…</time>` — never bare strings like "3 hours ago" |
| Date inputs | `<input type="date">` — no custom date picker markup |
| Datetime inputs | `<input type="datetime-local">` |
| Time-only inputs | `<input type="time">` |
| Dialogs / drawers / modals | `role="dialog"` + `aria-modal="true"` + `aria-labelledby="{id-of-title}"` |
| Live regions for per-item action status | `aria-live="polite"` on the status text container |
| Form labels | `<label for="{input-id}">` OR wrap the input — never visually-only |
| Focus rings | Visible `:focus-visible` outline on every interactive element |

## Inline viewport budget (600px tall)

The host gives inline/inline-card iframes ~400–600px of height (`hostContext.containerDimensions.maxHeight`). Every design MUST remain fully usable at 600px tall.

**Banned in inline/inline-card:**
1. `min-h-screen`, `h-screen`, `100vh`, `100dvh`, `100svh`, `100lvh` on any container.
2. Panels or forms with pixel heights ≥ 560px.
3. **Modals, dialogs, and overlays** — period. The host's height-overflow guard pushes them ~⅓ down the iframe regardless of anchor; the click-outside-to-dismiss surface misfires on scrollable bodies; users lose their place in the list. Use the §1.14 ScrollablePanel inline-expansion pattern instead. (`briefing-learnings.md` §2.4 has the full retirement record.)
4. Primary action buttons sitting at the natural bottom of a tall content block without being sticky.

**Required:**
1. Scrollable root — `h-full overflow-y-auto`.
2. Inline expansion panels — `<ScrollablePanel>` from `@agntux/ui-primitives` (sticky header + `flex-1 overflow-y-auto` body + sticky footer with primary action). The same primitive serves as the top-level layout for single-view handlers AND as the row-anchored expansion panel for list-view handlers.
3. Sticky primary actions inside `sticky bottom-0` footer (ScrollablePanel's `footer` prop wires this).
4. Sticky table headers — sticky `<thead>`.
5. `requestDisplayMode('fullscreen')` is opt-in enhancement, NEVER the workaround for inline overflow. Fullscreen is also the only sanctioned place to render a true blocking modal — if you genuinely need an overlay, request fullscreen first.

A test exists that renders the component at 600×400 via `renderAtInlineViewport` from `__tests__/test-utils/viewport` and asserts (a) the root is scrollable, (b) the primary action node is findable and reachable via `scrollIntoView()`, (c) no descendant has a computed height > 600.

## Compound action splitting

For every `sendFollowUpMessage` call that publishes user-authored text (`chat.postMessage`, `send_email`, comment/reply/post/dm) AND writes to an observation log in the same envelope: refactor into TWO sequential calls. Grep `*.tsx` for a template literal that combines `block(` or `inline(` on a user-text variable (`reply`, `message`, `body`, `draft`) with a log filename (`drafts-sent.md`, `activity.md`, `patterns.md`, `heartbeats.md`) — expected count: 0.

## Self-review additions (component-level)

- Sample three substituted files and confirm zero residual `{{...}}` placeholder strings.
- For each declared UI handler, confirm the component build (`npm run build` in `component/`) emits an `out/index.html` and the MCP server's build (`npm run build` in `mcp-server/`) successfully embeds it (no `__EMBED__<name>__INDEX_HTML__` placeholder survives in `dist/`).
- The `__tests__/` directory has at least: a happy-path test, an empty-state test, and an error-state test for the main component.
