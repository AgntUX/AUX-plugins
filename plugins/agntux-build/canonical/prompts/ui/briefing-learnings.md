# Briefing UI Learnings

The briefing component is a complex production reference, not a template. Most plugin UIs should be much simpler. Use this file as a checklist of *durable* learnings; ignore patterns the briefing tried that didn't work (Section 2).

The briefing is a 3,000+ LOC daily-summary MCP App that renders streaming Slack data, supports inline drafting, and persists state via the host's `widgetState`. It accumulated load-bearing primitives (defensive coercion, dual-key acceptance, link safety) alongside experiments that did not pay off (cross-app draft polling, custom hotkeys). This document separates the two so you can lift the durable parts into your own plugin without inheriting the experimental scaffolding.

The patterns are organized into three buckets:

1. **Section 1** — patterns to encode by default. These belong in the canonical scaffold for any non-trivial plugin UI.
2. **Section 2** — anti-patterns to *not* repeat. Each describes what the briefing did, why it didn't work, and what to do instead.
3. **Section 3** — patterns that are valid in advanced cases but should not appear in a first-day default scaffold.

The Section 1 items are short on opinion and heavy on shape: each one names the file or function in the briefing where the pattern lives, plus the canonical code shape so a future agent can pattern-match without re-reading the source. The Section 2 items are deliberately blunt — they exist because the alternatives are real and simpler, not because the briefing's authors did anything wrong; they shipped, learned, and recorded the lesson here.

---

## Section 1 — Patterns to encode

### 1.1 `safe-accessors.ts` typed coercion as mandatory primitive

The briefing's render tree assumes every array is an array, every string is a string, and every enum is one of the allowed values. That assumption is enforced by a thin module of typed coercion helpers (`safeArray<T>`, `safeString`, `safeNumber`, `safeBoolean`, `safeObject`, `safeEnum`). They live in `src/lib/safe-accessors.ts` and are applied at the parse boundary, before any field reaches the renderer.

The shape is small and complete:

```ts
export function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
export function safeString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
export function safeEnum<T extends string>(
  v: unknown, allowed: readonly T[], fallback: T,
): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v)
    ? (v as T) : fallback;
}
```

This is the foundational primitive that lets a streaming component render half-arrived JSON without throwing on a nested `undefined`. The same primitive belongs in the canonical `_template/` so every new plugin starts with it on day one — never inline `(x as string[])` in a renderer, and never call `.map` on something that arrived as `unknown`.

Why streaming makes this load-bearing: during a `ui/notifications/tool-input-partial` stream, every payload is the result of `JSON.parse` on an auto-closed truncation of the model's in-progress arguments. Any nested field can be `undefined`, `null`, or the wrong type; arrays can be half-written or come through as strings/numbers; strings can be non-strings. The render tree gets called dozens of times per second under those conditions. Type assertions are not enough — only runtime coercion at the boundary keeps the renderer from crashing on a partial.

The helpers are also small enough to ship as one file with no dependencies, no build step, and no risk of breaking a tree-shaken bundle. If you find yourself needing a sixth helper, audit first — most cases collapse onto `safeObject` plus a property access through one of the existing helpers.

### 1.2 Per-field `normalize<Entity>` fan-out

Each top-level entity has its own `normalize<Entity>(raw: unknown): Entity` function that calls `safeObject(raw)` once and then runs every field through the appropriate `safe*` accessor. Lists are constructed with the canonical shape `safeArray<unknown>(rawList).map(normalizeEntity)`.

The pattern in `main-component.tsx` looks like:

```ts
function normalizeChannelSummary(raw: unknown): ChannelSummary {
  const r = safeObject(raw);
  return {
    channel_id: safeString(r.channel_id ?? r.channelId),
    priority: safeEnum(r.priority, PRIORITY_VALUES, 'low'),
    highlights: safeArray<unknown>(r.highlights)
      .map((h) => safeString(h))
      .filter(Boolean),
    is_new_since_last_review: safeIsNew(r),
  };
}
```

Then at the top level:

```ts
return {
  channel_summaries: safeArray<unknown>(raw.channel_summaries).map(normalizeChannelSummary),
  // ...
};
```

This keeps coercion in exactly one place per entity and makes it trivial to add a new field without auditing every callsite. Renderers downstream get a fully-typed value with concrete defaults — no optional chaining noise, no defensive `Array.isArray` checks.

A few sub-rules that make this scale:

- One normalizer per entity, named `normalize<EntityName>`. Don't share normalizers across two entities even if they look similar — they will diverge and the shared one will become a maze of optional fields.
- The normalizer's return type is the strict, exported `Entity` type. Every field on that type must be assigned by the normalizer; relying on the `...r` spread defeats the point.
- Lists are always `safeArray<unknown>(rawList).map(normalizeEntity)`. The `<unknown>` is intentional — it forces the `.map` callback to take `unknown` and run it through coercion, rather than trusting the array element shape.
- Filter empty strings out of string lists at the normalizer (`.filter(Boolean)` or `.filter((p) => p.length > 0)`) so the renderer doesn't need to.

### 1.3 Snake_case + camelCase dual-key acceptance during in-flight renames

The platform was mid-rename from camelCase keys to canonical snake_case while the briefing shipped. Rather than break either side, every normalizer reads both keys and falls back to the legacy one. The canonical shape:

```ts
const channelSummariesRaw = payload.channel_summaries ?? payload.channelSummaries;
// ...
channel_id: safeString(r.channel_id ?? r.channelId),
thread_ts: typeof r.thread_ts === 'string' ? r.thread_ts
  : typeof r.threadTs === 'string' ? r.threadTs : undefined,
```

The output side picks one canonical shape (snake_case in the briefing's case) so consumers never have to branch. Apply this rule whenever a key is being renamed across the host/plugin boundary — accept both shapes, emit the preferred one. Once both producers have moved over, delete the fallback in a follow-up PR; do not leave the dual-read code permanent or it becomes structural.

Specifically, dual-key acceptance is a *transition* tool, not a defensive style. The cost of leaving it permanent: every grep for the field name returns two results, every type definition has to keep both keys optional, and a future contributor cannot tell which shape is canonical. Schedule the cleanup in the same epic as the rename so the dual-read window has a defined end date.

### 1.4 `extractFileText` four-shape helper for `{slug}_read_file` results

The MCP file-read tool returns plain text in four different shapes depending on host, SDK adapter version, and whether content blocks survived the round trip:

- A) MCP standard content blocks: `{ content: [{ type: 'text', text: '...' }, ...] }`
- B) Legacy string content: `{ content: '...' }`
- C) Single text block object: `{ content: { type: 'text', text: '...' } }`
- D) Raw string primitive: `'...'`

The briefing's `extractFileText(raw: unknown): string` (in `main-component.tsx`) collapses all four into the concatenated text or `''`. It also reads from `_content` first because the apps-client adapter strips `content[]` and stashes the raw blocks under `_content` when surfacing structuredContent to the widget; the four standard shapes are the compatibility tail. Any plugin that calls `{slug}_read_file` and parses the result needs this helper — don't reinvent it ad hoc, and don't try to force the host into one shape.

The contract is rigid: the helper takes `unknown`, never throws, joins multi-block text with `'\n'`, and returns `''` when no recognized shape applies. Callers branch on `''` to decide whether to retry or show an empty state.

Why all four shapes have to be handled: shape A is the MCP standard, shape B is what older or non-SDK hosts return, shape C shows up in tests that mock the raw `CallToolResult` shape directly, and shape D appears when an SDK adapter unwraps a single text block to its primitive form. Picking one shape and asserting on it will work in the harness you wrote it against and silently break in another. The helper is also test-friendly: every shape is a small JSON literal, so a four-case unit test costs nothing.

Sibling shapes for other tools: when calling `agntux_slack_list_files` (or any list-style tool), the result has been observed in shapes `{ files: [...] }`, `{ items: [...] }`, `{ entries: [...] }`, and `{ paths: [...] }`. The briefing's learning-panel modal handles the union the same way — read each candidate field in order, take the first array. The lesson generalizes: write a small extractor per tool, don't sprinkle the union across the renderer.

### 1.5 Defensive date helpers returning `'—'`

The host data mixes ISO strings with Slack-style numeric timestamps (`"1776740339.322000"`). The server-side normalizer converts those to ISO, but a single bad row should not crash the view nor render the literal string `"Invalid Date"`. The briefing's helpers in `main-component.tsx` are:

- `safeDate(iso: unknown): Date | null` — the parse boundary; everything else delegates to it.
- `formatTime(iso, fallback = '—')` — `2:14 PM` style.
- `formatDate(iso, opts, fallback = '—')` — `Mar 4` style.
- `formatDateTime(iso, opts, fallback = '—')` — combined.
- `daysSince(iso): number` — returns `0` when the input is unparseable so duration math never goes negative or NaN.

The contract is rigid: every date format helper takes `unknown`, never throws, and produces a stable em-dash placeholder for the unparseable case. Callers like `Math.max(1, daysSince(commitment.promised))` floor the result for copy like "X days overdue" so the UI reads naturally even when the data is missing.

Two specific failure modes the em-dash convention prevents:

- "Invalid Date" leaking into the UI. `new Date('not-a-date').toLocaleString()` returns the literal string `"Invalid Date"` in some browsers and throws a `RangeError` in others. Either is worse than `'—'`.
- Negative or NaN day counts. `daysSince` is used for "X days overdue" copy; if the input is undefined, `Math.ceil((Date.now() - NaN) / 86400000)` is `NaN`, and `"NaN days overdue"` ships to the user. Returning `0` and flooring at the call site (`Math.max(1, ...)`) keeps the copy sane in the worst case.

The choice of em-dash specifically (rather than empty string or "N/A") is deliberate: it visually occupies the same horizontal space as the formatted value would, so the layout doesn't shift when data is missing. For non-date placeholders elsewhere in the UI, follow the same rule — pick a glyph that preserves layout.

### 1.6 Default-true backwards-compat rule for new boolean flags

When a new boolean flag is added to a payload, default it to `true` if the field is absent so old `structuredContent` written before the flag existed continues to behave correctly. The briefing's `safeIsNew` helper makes this explicit:

```ts
function safeIsNew(raw: unknown): boolean {
  const r = safeObject(raw);
  const v = r.is_new_since_last_review ?? r.isNewSinceLastReview;
  if (v === undefined || v === null) return true;
  return v === true;
}
```

The reasoning: when the host hasn't yet started emitting the reviewed cursor, every item should be treated as new so nothing silently disappears into an "Already reviewed" bucket. Only an explicit `false` hides it.

The general rule — pick the safe default per flag. For "should I show this thing?" booleans, default to true (the cost of showing too much briefly is lower than the cost of silently hiding). For "should I take destructive action?" booleans, default to false. Document the choice inline in the helper so a future "cleanup" pass doesn't flip the default by accident; the comment is part of the contract.

A subtler version of this rule applies to enum flags. The briefing's `safeEnum(r.priority, PRIORITY_VALUES, 'low')` defaults to `'low'` when the field is absent, which is the safest default for a "noisiness" enum — an unknown priority message should not be loud. Pick the enum default the same way: which value causes the least harm if the field is missing entirely.

### 1.7 `<button>` + `useAppsClient().openLink()` for ALL external links

The MCP App iframe is sandboxed without `allow-top-navigation`, so a plain `<a href="...">` will be silently blocked: clicks do nothing, no error, no navigation. The fix, encoded in `src/components/shared/slack-link.tsx`, is to render every external link as a `<button>` whose `onClick` calls `client.openLink(url)` from `useAppsClient()`. The internal helper looks like:

```tsx
const client = useAppsClient();
return (
  <button
    type="button"
    onClick={() => { void client.openLink(url); }}
    className={BASE_CLASSES}
    aria-label={label}
  >
    {children}
  </button>
);
```

The rule:

- **Never** ship `<a href="...">` to an external URL from an MCP App.
- **Always** render `<button onClick={() => void client.openLink(url)}>`.
- Style the button to look like a link if you want underline-on-hover; the visual treatment is independent of the element. The briefing's `BASE_CLASSES` resets `<button>` chrome (`bg-transparent border-0 p-0 m-0 inline text-inherit font-inherit hover:underline`) so the button is visually indistinguishable from prose.
- When the URL would be empty (missing id, fallback path), render a plain `<span>` so React never emits a button with no action.

Failure mode this prevents: a link-shaped affordance the user clicks repeatedly with no feedback, because the iframe sandbox is dropping the navigation. There is no console warning when this fails — the click event simply has no effect — so it is impossible to debug without knowing the cause in advance.

There is one corner case worth calling out: when the URL helper returns `''` (missing channel id, unsupported user fallback), do NOT render an empty button. The briefing's `SubtleLinkButton` returns a `<span>` instead, so accessibility tools and click handlers don't see a button with no behavior. The general rule: if the action would no-op, render the inert element instead of an actionable one.

### 1.8 `ComponentErrorBoundary` as mandatory tree-root with retry

The component tree is wrapped in a class-based `ComponentErrorBoundary` (in `src/components/error-boundary.tsx`) whose `getDerivedStateFromError` flips a `hasError` flag, logs to `console.error` with the component stack, and renders an in-iframe alert card with a Retry button. The retry handler resets the error state (`{ hasError: false, error: null }`) so a transient malformed payload doesn't permanently brick the view.

Without this boundary, a single bad render — an undefined field reached through bad coercion, a malformed payload field, a thrown helper — turns the whole iframe into a black screen with no recovery path. The host has no way to inject a retry affordance into your iframe; if you don't render one yourself, the only fix is for the user to refresh the conversation.

The boundary belongs in the canonical `_template/` and should wrap the top-level component before it is exported. The briefing exports `MainComponentInner` separately and wraps with the boundary at the export site, which keeps the inner function testable in isolation. The fallback UI uses Tailwind tokens (`bg-card`, `text-card-foreground`, `border-border`) so it inherits the host's theme without extra plumbing.

Sub-rules for the boundary:

- It must be a **class** component. React function components cannot implement `componentDidCatch` or `getDerivedStateFromError`. Resist the temptation to "modernize" it.
- The retry button must be a real `<button type="button">` so it is focusable and keyboard-accessible. Test the retry path explicitly — a boundary that catches but cannot recover is barely better than no boundary.
- The error message displayed (`this.state.error?.message`) is for developers, not users. Style it as a small monospace block (`bg-muted`, `text-xs`) so it doesn't dominate the fallback.
- Do not log the error to a remote sink in the boundary itself; the host already captures `console.error`. Adding a fetch from inside the boundary creates a second failure path.

The fallback also needs to be reachable without the rest of the tree mounted. If your component depends on context providers above it, the boundary must sit above those providers — otherwise a thrown render inside a provider takes down the boundary too.

### 1.9 Inline-SVG Spinner primitive — no icon library dep

The briefing's `Spinner` is a 20-line inline SVG with `animate-spin` and `currentColor`, defined right in `main-component.tsx`. No `lucide-react`, no `@heroicons`, no icon-library dependency. The shape:

```tsx
function Spinner({ className = 'h-3 w-3', testid }: {
  className?: string; testid?: string;
}) {
  return (
    <svg aria-hidden="true" className={`${className} animate-spin text-current`}
         viewBox="0 0 24 24" fill="none" data-testid={testid}>
      <circle cx="12" cy="12" r="10" stroke="currentColor"
              strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor"
            strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
```

MCP App bundles ship through a constrained build pipeline and every external dep multiplies bundle size and chance of version drift. For a single spinner — and most plugins only need one or two icons — write the SVG inline with `viewBox`, `aria-hidden="true"`, and a `data-testid` for tests. `currentColor` + `text-current` lets the spinner inherit color from any context (button, badge, headline) without per-call configuration. This belongs in the canonical `_template/`.

The same logic applies to other small icons. If you need a chevron, a check, or a close glyph, write the SVG inline. The Tailwind `animate-spin`, `animate-pulse`, and `animate-bounce` classes cover almost every animation a plugin needs. The dependency budget for an MCP App is roughly: React, the MCP App SDK helpers, your translation strings — anything else needs a justification.

### 1.10 `sendFollowUpMessage` envelope discipline for silent persistence

When the component needs the host to mutate state without re-rendering — e.g. recording that a draft was sent, clearing a pending row, persisting a preference — the call is a `sendFollowUpMessage` whose prompt is a rigid, instruction-only envelope. The discipline:

- Address exactly one tool call.
- Forbid any commentary.
- Forbid `render_*` re-renders.
- Specify the exact tool, exact arguments, and the termination clause (e.g. "After the prepend succeeds, STOP. No re-render, no other tool calls, no assistant text.").

Example shape from the briefing:

```
The reply to thread @id:${id} was just sent. Remove any lingering pending-draft
rows for this action item from drafts-pending.md via agntux_slack_edit_file —
delete every line whose "@action_item_id:${id}" token is present. Do not add
any commentary.
```

Without the rigid termination clause, the model often appends "I'll also re-render the briefing" or chains a second tool call, which causes flicker and double-writes. Treat each follow-up envelope like a one-line backend RPC: schema-locked input, side effect, stop.

A few sub-rules that help the envelope land reliably:

- Include the exact tool name (`agntux_slack_edit_file`), not a description ("the slack edit tool").
- Inline literal data with template strings so the model has nothing to "interpret" — `@id:${id}` not "for this item".
- End with a one-sentence STOP clause; the model is unusually good at obeying explicit termination instructions.
- Keep the envelope under ~150 words. Longer envelopes invite the model to "summarize what it just did", which is exactly what the discipline is meant to prevent.
- If the operation has a postcondition you can verify (e.g. "the file should have one fewer matching line"), state it as a postcondition, not as a check the model should run. The model running a verification step doubles the side-effect surface.

When in doubt about whether to use a follow-up envelope vs a `callTool`: prefer `callTool` when the component already has the data and the host exposes a tool for it; reserve `sendFollowUpMessage` for cases where the model genuinely needs to compose content (a draft reply, a summary) that the component can't author itself.

### 1.11 — moved

The previous §1.11 ScrollableModal entry is retired. Modals are forbidden in inline iframes — see §2.4 for the anti-pattern record. The canonical scrollable layout primitive is now §1.14 (ScrollablePanel), which is non-modal and used either as the top-level layout (slack handlers) or anchored inside a row (agntux-core triage's inline expansion panels).

### 1.12 `widgetState` vs local `useState` — the cleanup-on-rerender test

The single hardest decision when wiring a new control is whether its state belongs in `widgetState` (host-persisted, model-visible, costs token budget) or local `useState` (ephemeral, free, lost on re-render). The rule, distilled from the briefing:

> If the state should reset cleanly when the host re-renders the widget with fresh tool output, it belongs in `useState`. If it should persist across re-renders, it belongs in `widgetState`.

Concretely:

| Goes in `widgetState` | Goes in `useState` |
|---|---|
| Filter selections (sort order, status filter) | Modal open/close flags (`editingId`, `isCreateOpen`) |
| Expanded/collapsed accordion state | Input values in an unsaved form |
| "Hide done" toggle (current-session value) | Per-action loading flag (`filingId`, `isSending`) |
| Selected-row IDs in a list | Hover/focus-ring decoration |
| Tab the user is on (within a tabbed view) | Transient error message tied to one button click |

The briefing learned this the hard way: an early version stored every transient flag in `widgetState`, which (a) blew through the 4k-token budget within a few rows, and (b) caused jarring resurrections — a modal would re-open after a re-render because its `isOpen` flag persisted. Both classes of bug disappeared once the rule above was applied.

Two adjuncts that come up a lot:

- **Sticky defaults are not `widgetState`.** A persistable default (`hide_done_default: true` so every fresh render starts with done hidden) lives in app-scoped `preferences.md`, not in `widgetState`. The component seeds `widgetState` from `appPreferences.ui_defaults` on mount; after that, the toggle writes to `widgetState` only. The default is persisted to `preferences.md` only when the user says "always," "by default," "from now on," or taps an explicit "make this my default" affordance.
- **Form input values commit to `widgetState` only on save.** Until the user clicks Save, an unsaved title/textarea lives in `useState` — losing it on a re-render is the right behavior (it forces the user to confirm they care about the change rather than accumulating ghost edits across renders).

Document the choice for each `widgetState` key in a one-line comment so a future contributor knows whether to bump the budget or move the field to `useState`.

### 1.14 `ScrollablePanel` inline-expansion primitive (non-modal layout)

`@agntux/ui-primitives`'s `ScrollablePanel` is the canonical layout primitive for any inline-iframe view. Sticky header + `flex-1 overflow-y-auto` body + optional sticky footer. The full type:

```tsx
interface ScrollablePanelProps {
  title: ReactNode;
  onDismiss?: () => void;
  onHelpClick?: () => void;   // caller wires openLink dispatch
  helpLabel?: string;          // aria-label for the help button (default "Help")
  children: ReactNode;
  footer?: ReactNode;
}
```

Two valid shapes:

1. **Top-level layout for an iframe view** — wrap `<MainComponent>`'s body content. The header carries the plugin's logo + title chip; the footer carries the Send / Cancel buttons. This is what agntux-slack's compose and canvas handlers use.

2. **Inline expansion panel** anchored to a row — render inside an action row in agntux-core's triage view to surface details / snooze / dismiss / "Do something else". Replaces the older centred-modal pattern (§2.4).

Both shapes share the same primitive; the difference is just where it's mounted and how the parent constrains its height. The primitive itself uses `h-full` so the parent's container determines the visible size.

Why non-modal: the briefing's older `ScrollableModal` (retired in agntux-core 6.1.0 / agntux-slack 5.0.0) anchored to a row but the host's height-overflow guard pushed it ~⅓ down the iframe regardless of where the user clicked, breaking the "stay anchored to the row I'm acting on" promise. ScrollablePanel sidesteps the positioning math by being a layout, not an overlay — it occupies whatever space its parent allots, no portal, no `position: fixed`, no focus-trap (the iframe boundary is the focus trap).

The primitive ships in the workspace package at `packages/agntux-ui-primitives/` (per the AUX-plugins marketplace layout); plugins import via `import { ScrollablePanel } from '@agntux/ui-primitives'`. The toolkit's `_template/` scaffolds it pre-wired.

### 1.15 Optimistic-hide for status-mutating mutations

When the user clicks an action that mutates status (`set_status`, `dismiss`, `snooze`), the row should vanish from the list **immediately** — before the mutation round-trips. The user sees instant feedback; the host completes the mutation in the background; the list reconciles when the next render arrives.

Reference shape from agntux-core 6.1.0's triage handler:

```tsx
const [optimisticallyHidden, setOptimisticallyHidden] = useState<Set<string>>(new Set());

// Regex of host-prompt fragments that signal a terminating prompt.
const TERMINATING_PROMPT_PATTERNS = /(set_status|dismiss|snooze|mark.*done)/i;

const handleSuggestedAction = (action: SuggestedAction) => {
  if (action.host_prompt && TERMINATING_PROMPT_PATTERNS.test(action.host_prompt)) {
    setOptimisticallyHidden(prev => new Set(prev).add(action.id));
  }
  // ...dispatch the action via sendFollowUpMessage / openLink.
};

// Reconcile on rerender — if the host-emitted toolOutput no longer contains
// the hidden id, drop it from the local set.
useEffect(() => {
  setOptimisticallyHidden(prev => {
    const next = new Set<string>();
    for (const id of prev) if (toolOutput.actions.some(a => a.id === id)) next.add(id);
    return next.size === prev.size ? prev : next;
  });
}, [toolOutput.actions]);
```

Three load-bearing rules:

- **`useState`, not `widgetState`.** Optimistic hiding is ephemeral — it should reset cleanly on the next host re-render. Persisting in `widgetState` would resurrect hidden rows on every re-render.
- **Scope-guard via regex on the host_prompt.** Only `set_status`, `dismiss`, `snooze` (and similar terminating verbs) trigger the hide. A "Draft a reply" click should NOT hide the row — the action stays open until the user confirms send.
- **Reconcile-on-rerender.** When the host's next `toolOutput` arrives and the action is gone (mutation succeeded), the local set is pruned automatically. If the action is still present (mutation failed or was rolled back), the row reappears. The `Set` survives across renders only as long as the host hasn't yet authoritatively acknowledged the change.

### 1.16 SuggestedAction `url` field + safe-scheme dispatch

Suggested-action buttons support **dual dispatch**: each button carries `host_prompt` (routes via `sendFollowUpMessage`) **or** `url` (routes via `client.openLink()`), but never both. This is the `agntux-core` hub contract — see `${CLAUDE_PLUGIN_ROOT}/canonical/prompts/agntux-core-hub-contract.md` §2 and §5.

The TypeScript shape on the action item:

```ts
interface SuggestedAction {
  label: string;                     // visible button text
  host_prompt?: string;              // composition / chat dispatch
  url?: string;                      // direct deep-link via openLink
}
```

The hub validates `url` is a safe scheme (`https:` or `http:` only) before dispatching. `javascript:`, `data:`, `file:` URLs are rejected and silently dropped (the button still renders; clicks become no-ops). The validator parser:

```ts
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
```

Why not allow other schemes: an MCP App iframe is sandboxed, but `openLink` runs in the host context. A plugin emitting `javascript:alert(...)` could otherwise inject code into the host. The schemes we reject are the OWASP-Top-10 vectors for XSS via URL.

This is **agntux-core hub contract** — source plugins emit `url` on their suggested-action entries; the hub renders + validates + dispatches. Don't re-implement the dispatch in your plugin; emit the right shape and the hub does the rest. See `ingest-prompt-author.md` § "What to emit on `suggested_actions`" for when to use `host_prompt` vs `url`.

### 1.17 In-list feedback rows replace toasts

Toast notifications (a positioned banner that fades after a few seconds) are a poor fit for a 600px iframe — they overlay content the user might be reading and disappear before the user finishes scrolling. The agntux-core 6.1.0 pattern: when a terminating action resolves, the row is replaced **in its slot** by a feedback row that sits there for ~5 seconds before dropping out.

Reference shape:

```tsx
const FEEDBACK_FADE_MS = 5000;
const [feedbackRows, setFeedbackRows] = useState<Record<string, FeedbackRow>>({});

// When a status mutation succeeds:
setFeedbackRows(prev => ({
  ...prev,
  [actionId]: { kind: 'done', label: '✓ Marked done', title: action.title, addedAt: Date.now() },
}));
setTimeout(() => {
  setFeedbackRows(prev => {
    const next = { ...prev };
    delete next[actionId];
    return next;
  });
}, FEEDBACK_FADE_MS);
```

In the list render:

```tsx
{actions.map(action => {
  const fb = feedbackRows[action.id];
  if (fb) return <FeedbackRow key={action.id} row={fb} />;   // takes the slot
  if (optimisticallyHidden.has(action.id)) return null;       // §1.15
  return <ActionRow key={action.id} action={action} />;
})}
```

Three load-bearing properties:

- **Preserves scroll position.** The feedback row occupies the same slot as the resolved item, so the list doesn't reflow on action resolution. Users keep their place.
- **`role="status"` + `aria-live="polite"`** so screen readers announce the resolution without stealing focus. Set on the FeedbackRow's root element.
- **Counter updates exclude the feedback'd ids.** A header showing "3 high priority" should drop to 2 the moment the user clicks Done — don't wait for the feedback row to fade. Compute counts from `actions.filter(a => !feedbackRows[a.id])`.

This replaces `<Toast>` entirely. The toast component is deleted from agntux-core 6.1.0+; new plugins should not introduce one. If you genuinely need a non-row notification (e.g., for a global error not tied to a specific item), surface it as a sticky banner at the top or bottom of the list, not as a positioned toast.

Cross-reference: `state-management.md` (the `useState` vs `widgetState` rule from §1.12 applies — feedback rows are ephemeral, so `useState`); `action-feedback.md` (the lifecycle model — feedback rows are the success-state UI for terminating mutations).

### 1.13 List-tool four-shape extractor (sibling of `extractFileText`)

The list-style tools on a plugin's MCP server (`{slug}_list_files` and any user-authored list tool — the briefing's learning panel calls one for "saved learnings") return their array under one of four field names depending on host, SDK adapter version, and how the tool author named it:

- A) `{ files: [...] }`
- B) `{ items: [...] }`
- C) `{ entries: [...] }`
- D) `{ paths: [...] }`

This is the same class of shape-drift that motivates `extractFileText` (see 1.4). The same shape of helper applies — a small per-tool extractor that takes `unknown`, never throws, and returns the first array it recognizes (or `[]`):

```ts
export function extractListEntries(raw: unknown): unknown[] {
  const r = safeObject(raw);
  for (const key of ['files', 'items', 'entries', 'paths'] as const) {
    const v = r[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}
```

Then run each entry through the appropriate `normalize<Entity>` per 1.2.

The rule generalizes: when a tool's result shape is observed to vary across hosts/adapters, write one extractor for that tool, place it next to its caller, and unit-test all four shapes. Do not sprinkle the union of shapes across the renderer — every callsite that branches on shape is a place a new shape will silently break.

When you encounter a *fifth* shape in the wild, add it to the extractor and to the test, and leave a comment naming the host/SDK that produced it. Five-and-counting is the threshold at which to escalate to the host or SDK maintainer rather than continue to absorb drift; until then, the extractor is the cheapest insurance.

---

## Section 2 — Anti-patterns we explicitly do NOT recommend

These three patterns appeared in the briefing and should not be carried into new plugins. Each is unambiguous: **do not implement**. The verdict line at the top of each subsection (`**Status: anti-pattern. Do not adopt.**`) is the canonical answer; the surrounding prose explains how the briefing got there and what to reach for instead.

If a future component genuinely seems to need one of these, treat that as a signal to escalate to the orchestrator before writing code, not as a reason to bring the pattern back. The "Prefer instead" alternatives have shipped successfully in production; the anti-pattern is recorded *because* the simpler alternative replaced it.

### 2.1 Fire-and-poll for in-place artifacts via a `*-pending.md` file

**Status: anti-pattern. Do not adopt.**

**What the briefing did**: The "Suggest a reply" flow generates a `requestId`, sends a `sendFollowUpMessage` envelope instructing the host to append exactly one schema-locked line to `drafts-pending.md` of the form

```
@thread_ts:... @action_item_id:... @request_id:... @tone:... @word_count:N
@ts:ISO @body:"<escaped single-line body>"
```

then polls `{slug}_read_file` on that file every ~1.5s with a ~30s deadline. Each poll iteration parses the file with `parsePendingDraftLine` (in `src/lib/parse-pending-draft-line.ts`), looks for a row whose `@request_id` matches, and on match writes the body into `widgetState.draftOverrides[itemId]`, which the renderer reads in preference to the payload. Sending or canceling clears the override and emits a third envelope to `agntux_slack_edit_file` to delete the line.

**Why we don't recommend it**:

- Coordination spans host + filesystem artifact + component state, so a failure in any one leaves orphaned rows or stuck spinners.
- `requestId` matching is fragile — the host can normalize `action_item_id` (e.g. reconstructing it from `channel:ts`), and any divergence breaks the match silently.
- Polling every 1.5s wastes tool calls and flickers the UI.
- The 30s timeout window confuses users — the spinner just stops with no clear feedback path.
- The escape rules for the `@body:"..."` field (single-line, escape `\n` and `\"`) require a custom parser that has to stay byte-for-byte in sync with the host writer; any drift produces silent parse failures.
- Cleanup is its own envelope, so cancellation requires a third round trip — and if that envelope fails, you have orphan rows accumulating in the `*-pending.md` file forever.

**Prefer instead**: Tool-call-and-render — call a render tool with the data and let the host pass it back through `toolOutput`. The component reads from `toolOutput`, not from a polled file. The host writes the durable copy if it needs to be persisted; the component never owns the polling loop.

If you genuinely need a long-running model side-effect to surface back into the UI, the right shape is: (1) component calls a tool, (2) tool runs the model, (3) tool returns the result in `toolOutput`. No file artifact, no polling, no requestId matching. The latency you save from "polling every 1.5s" is illusory — the model still has to finish before the result is available; what changes is whether the component is in charge of waiting or the host is.

### 2.2 `PendingAction` cross-app debounce union

**Status: anti-pattern. Do not adopt.**

**What the briefing did**: A `PendingAction` discriminated union plus a `pendingRef` and a `setPending` callback gate every async operation across the component (tab switches, suggest-draft, send-reply, mark-resolved, todo-create). The shape:

```ts
type PendingAction =
  | { kind: 'tab'; target: TabId; startedAt: number }
  | { kind: 'button'; id: string; label: string; startedAt: number }
  | null;
```

The union is meant to act as a cross-call debounce: while one async action is pending, others are blocked or coalesced based on `kind` + `id`. Combined with the polling lifecycle from 2.1, the result is several layers of state machines tracking which of N possible side effects is currently in flight, with a single global `pendingRef` consulted from every callback.

**Why we don't recommend it**:

- The union grows linearly with action types; every new action requires editing the union, the setter, and every guard site.
- Debouncing across heterogeneous actions creates a single global lock that's almost never the right granularity — you end up adding bypass paths.
- Combined with the file-polling loop in 2.1, debugging "why is my button stuck in spinner state" requires inspecting both the union and the poll abort signal.
- It is not portable across plugins — every new component would have to recreate its own union with its own action shapes.
- The `startedAt` field invites timeout heuristics ("if it's been pending for >30s, force-clear it") that paper over the real problem instead of fixing the underlying coordination.

**Prefer instead**: Per-action local `useState<boolean>` for the loading flag of that specific button or tab, with `AbortController` for cancellation if needed. If multiple actions truly need a shared mutex, lift it into a focused hook with one well-defined scope, not a union of every possible action across the app. Most plugins will never need a shared mutex at all.

If you find yourself reaching for the union, the underlying problem is usually that two buttons are racing on the same backend resource. Solve that at the resource layer (idempotent operations, last-write-wins, server-side dedup) rather than at the UI debounce layer. The UI mutex is the wrong place to enforce backend invariants.

### 2.4 Modal layouts in inline iframes

**Status: anti-pattern. Do not adopt.**

**What the briefing did**: An earlier iteration shipped `ScrollableModal`
— a focus-trapping overlay primitive (`role="dialog"`, `aria-modal="true"`,
portal-to-document.body, Escape + Tab key listeners scoped to the
modal's lifecycle) — as the canonical surface for "open the action
card's details", "confirm a snooze", "edit a reply before sending".
The primitive was technically clean (lifecycle-bounded listener, focus
restoration, click-outside dismissal), but every modal-in-iframe
deployment hit the same UX bug: the host's height-overflow guard
clamped the modal to roughly ⅓ down the iframe regardless of where
the user clicked, so the modal never anchored to the action row that
opened it. Users routinely lost their place in the list.

**Why we don't recommend it**:

- The 600px iframe budget makes "modal" the wrong shape — there's no
  off-screen space to reveal; the modal has to render somewhere
  on-screen, and the only available placements compete with the
  underlying content.
- The host-side height-overflow guard's anchoring math interacts
  badly with iframe-relative positioning. The result is consistently
  off-anchor, with no clean fix from the iframe side.
- Centred modals yank focus away from the row the user just clicked,
  forcing a context shift the user didn't ask for.
- Click-outside-to-dismiss often misfires inside the modal's own
  scrollable body — clicks on a scrollbar or a long body section can
  bubble up and close the dialog the user is actively using.
- The accessibility primitives (`role="dialog"`, `aria-modal`, focus
  trap) are still correct in principle — they just don't compose
  well with the iframe sandboxing.

**Prefer instead**: §1.14's `ScrollablePanel` non-modal layout
primitive. Two patterns:

- **Top-level view**: the entire iframe is one ScrollablePanel — used
  for compose / canvas / single-purpose handlers. The "modal" content
  is the iframe content; the iframe itself is the modal-like surface.
- **Inline expansion panel** (§1.15): when a list-view handler needs
  to surface action details / confirmation / form, render a
  ScrollablePanel-shaped element inline in the row's slot rather than
  opening an overlay. The list reflows to make space, the user stays
  anchored to the row they clicked, and the optimistic-hide pattern
  (§1.15) makes the resolution feel instant.

Both replacements ship in `agntux-core` 6.1.0+ and `agntux-slack`
5.0.0+. The retirement is final — the primitive's source is deleted
from those plugins, the `_template/` scaffold no longer ships it,
and `ui-handler-author.md` calls modals out as forbidden in inline
iframes.

If you genuinely need an overlay (a true blocking dialog —
"Are you sure you want to delete this?" with no other interaction
allowed until the user picks Yes/No), the right escape hatch is
`requestDisplayMode('fullscreen')` first, then render the modal in
fullscreen where the math works. Never render an overlay in inline
mode.

### 2.3 Custom hotkey layers

**Status: anti-pattern. Do not adopt.** (No exceptions in inline iframes — the older modal-Escape / focus-trap carve-out from §1.11 is also retired now that modals themselves are retired; see §2.4. The iframe boundary is the focus trap.)

**What the briefing did**: An earlier iteration of the briefing component installed a `keydown` listener on `document` that captured shortcuts like `Cmd+K`, `Cmd+Enter`, and arrow-key navigation across action items. It was removed in a later iteration after it kept stealing keystrokes from the host's own keymap. (The briefing also shipped an Escape + Tab focus-trap listener scoped to an open `ScrollableModal` — that listener is now obsolete because the `ScrollableModal` primitive itself is retired and modals are forbidden in inline iframes; see §2.4.)

**Why we don't recommend it**:

- The host controls the user's keymap. An MCP App that captures Cmd+K, Cmd+Enter, slash, etc. silently breaks the host's own command palette, send-message, or focus shortcuts.
- Every host platform has slightly different conventions (Cmd vs Ctrl, Enter vs Cmd+Enter to send), so any custom binding has to ship a per-platform table that drifts immediately.
- Capturing keys in the iframe also fights the host's focus management — the host expects the iframe to defer global hotkeys.
- Maintenance cost is permanent — you're shadowing the host's keymap forever, and discovery (a tooltip? a help overlay?) competes with the host's own help affordances.
- Iframes get keystrokes only when focused, so even a "working" hotkey layer is invisible to power users who expect it to work from anywhere in the host.

**Prefer instead**: Rely on the host keymap. Limit `keydown` listeners to keys that are unambiguously local: Escape inside an open modal, arrow keys inside a listbox you own, Tab/Shift+Tab focus traps inside a dialog. If the host exposes a keymap-extension API, use that; otherwise do not bind global shortcuts.

The narrow Escape/Tab focus-trap carve-out described in earlier iterations of this section is also retired in the modern toolkit (see §2.4 for the modal retirement). Inline iframes have no in-iframe modals to focus-trap, so there is nothing to scope a `keydown` listener to. If a future fullscreen-mode handler genuinely needs a blocking overlay, the focus-trap pattern can be re-introduced there with a lifecycle-bounded listener; for inline iframes, do not bind keystrokes at all.

---

## Section 3 — Useful in advanced cases

These are valid patterns in specific contexts but should NOT appear in the first-day default scaffold. Skip them unless the situation in the parenthetical actually applies.

### 3.1 View-mode switcher: render both icons, never highlight active

`PersistentHeader` exposes inline / fullscreen toggle buttons that call `requestDisplayMode('inline' | 'fullscreen')`, but it does NOT visually highlight the active mode based on the `displayMode` prop. The host's mode-reporting (`displayMode` / `availableDisplayModes`) has been observed to be unreliable and lag the actual iframe state, so highlighting based on it would be wrong as often as right. Render both affordances, let the user pick, and trust the host's response. Only adopt this pattern if your component genuinely needs both inline and fullscreen modes — most don't.

If you do adopt it, gate the buttons on `requestDisplayMode` being defined (it can be undefined when the host doesn't support display-mode requests at all) and silently swallow rejections from the request — the user does not need a toast for "fullscreen is not currently available."

### 3.2 Slack-style deep-link primitives + `<SubdomainProvider>` context with prop override

`src/components/shared/slack-link.tsx` exposes `ChannelLink`, `UserLink`, `ThreadLink` backed by URL builders in `src/lib/slack-links.ts`. The workspace subdomain reaches the link via a `<SubdomainProvider>` context wrapping the tree, with an optional per-call `subdomain` prop override (explicit `undefined` falls through to context; explicit `null` forces the universal-redirect fallback path). This is worth lifting only when you're rendering many product-specific deep links to the same workspace; for a single-link plugin, just pass the URL down as a prop.

The "context with prop override" trichotomy (undefined → context, null → forced fallback, string → use it) is worth copying for any value that defaults from a global but needs per-call escape hatches. Don't collapse `undefined` and `null` into the same case — the distinction is what makes test isolation work.

### 3.3 `perfMark` via `console.warn` for test-harness capture

`src/lib/perf.ts` is a 10-line `perfMark(label, extra?)` that logs `[perf] ${label} dt=${ms}ms` via `console.warn`. The reason it's `warn` and not `log`: the workflow-test harness only captures `warn`+`error`, so timing marks survive the round trip and tests can assert on them. Useful when you have a test harness that needs to assert on render timing; otherwise an inline `performance.mark` is fine and avoids the channel abuse.

### 3.4 Hide model-derived UI when `samples=0`

A 0-sample confidence bar is meaningless — it represents a model with no evidence. The briefing renders the `<ConfidenceMeter>` only when `safeNumber(item.tier_samples) > 0`. The general rule: model-derived chrome (confidence bars, predicted-tier badges, "based on N samples" copy) should be gated on `samples > 0`. Don't render a 0% bar; render nothing. The user reads "0% confident" as "the model is sure this is wrong" rather than "the model has not yet seen evidence" — the meanings are opposite, so the rendering must hide rather than show-with-zero.

The same logic extends to "auto-detected" badges, learning-state pills, and any other UI that exposes the model's internal state. If the underlying signal is uninformative (zero samples, "observing" state, no confidence yet), prefer to hide rather than render-with-loading-state — the user does not benefit from knowing the model is silent.

### 3.5 Already-reviewed accordion + "Mark all reviewed" pattern

For "new since last visit" surfaces, the briefing splits the list into an unreviewed section and a collapsed "Already reviewed · N" accordion driven by `widgetState.alreadyReviewedExpanded`. There is also a single bulk-action affordance to mark everything reviewed at once. Use this only when you genuinely have a reviewed-cursor concept (a `component_last_reviewed_at` watermark in the payload) and a list large enough that an accordion improves scannability — for short lists, just render the items and skip the cognitive overhead.

The accordion state lives in `widgetState`, not local component state, so the open/closed condition survives a re-render of the whole component when new data arrives. This is the right home for any "view preference" the user has expressed — collapse states, sort orders, filter selections — because the host persists `widgetState` across the component lifecycle. Pure derived UI state (a hover, a focus ring) stays in local `useState`.

---

## How to use this file

When starting a new plugin UI:

1. Pull in the Section 1 primitives wholesale. They cost almost nothing and prevent the most common runtime crashes (undefined-field reads, malformed dates, blocked external links, mid-rename key drift).
2. Read Section 2 as hard rules — those three patterns cost the briefing real time and complexity, and there are simpler alternatives in every case.
3. Treat Section 3 as a menu — only adopt items whose triggering condition (parenthetical) applies to your component.

The briefing was built before some of these lessons were clear. The new canonical `_template/` should ship with Section 1 already wired in (`safe-accessors.ts`, `ComponentErrorBoundary`, inline `Spinner`) so plugins inherit the durable parts and avoid the experimental ones. Future learnings — patterns that have proven themselves in two or more plugins — should be folded into Section 1 with the same shape: file or function name, canonical code, and the single-paragraph "why" that justifies the cost of teaching every future agent the rule.

#### Promotion rules between sections

A pattern moves from Section 3 into Section 1 once it has been needed in two or more independent plugins. A pattern enters Section 2 once a plugin has *removed* it because the simpler alternative shipped successfully. Both directions need a concrete artifact attached — a PR link, a commit hash, or at minimum the plugin name where the lesson was learned — so this file can be audited rather than accreting opinion.

A pattern leaves the file entirely once it has been encoded into the `_template/` directly: the `_template/` is the executable form of Section 1, and once a primitive is in there, the prose entry can be reduced to a single sentence ("see `_template/safe-accessors.ts`"). Avoid doubling — code in the template *and* prose in the learnings — because one of them will silently fall out of date.

#### What this file is not

This is a learnings document, not a style guide. It does not cover Tailwind class conventions, file layout, naming, or any other topic where the briefing is just one of several reasonable styles. If a topic does not have a hard "do this / do not do this" answer drawn from the briefing's experience, it does not belong here.

It also does not cover MCP App protocol fundamentals (`widgetState`, `toolOutput`, `callTool`, `sendFollowUpMessage`, `requestDisplayMode`, `useAppsClient`). Those live in the protocol reference (`mcp-apps-protocol.md`). When a learning here references one of those primitives, the reader is expected to already know what it does — the learning is about how to use it well, not what it is.

Finally, this is not a comprehensive review of the briefing component. The briefing has many small details (skeleton loaders, layout-shift mitigation, translation strategy, tab indicator animations, focus session UX) that are reasonable choices but not yet validated as load-bearing across multiple plugins. Those stay in the briefing's source as reference, and may be promoted into this file when a second plugin needs them.

The bias of this document is toward *preventing regressions*. Every Section 1 entry exists because the absence of that pattern caused at least one real bug in production; every Section 2 entry exists because the presence of that pattern caused complexity the team eventually paid down. Read it that way — as a record of where the rough edges were — rather than as architectural advice in the abstract. The architectural advice in the abstract belongs in design docs and ADRs, not in a learnings file scoped to a single component.

When in doubt about whether to follow a rule here, default to following it. The cost of following a rule that turns out not to apply to your situation is small (a few extra lines of coercion, an extra wrapper component); the cost of skipping a rule that does apply is a class of bugs the briefing already mapped out for you.

If you find a Section 1 rule that is hurting your component — making it slower, harder to read, or actively wrong for your case — flag it for the orchestrator before deviating. The rule may have an exception that has not been recorded yet, or your case may be the second example needed to refine it. Either outcome is more useful than a silent local override that diverges from the canonical scaffold without explanation.

If you find a Section 2 anti-pattern that *would* solve your problem cleanly, flag that too. The anti-pattern is recorded because of failures observed in one specific shape; a different shape might not hit the same failure modes. The flag exists so this file can be revised based on evidence, not so the anti-pattern can be re-introduced silently.
