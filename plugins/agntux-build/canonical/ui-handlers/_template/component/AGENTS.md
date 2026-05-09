# AGENTS.md - Coding Agent Documentation

This document covers template-specific patterns. For MCP Apps concepts, tool output data flow, write-back patterns, security, and accessibility, refer to the context provided in your system prompt.

## Quick Start

**PRIMARY EDIT FILE:** `src/components/main-component.tsx`

1. Read this file first to understand available patterns
2. Edit `src/components/main-component.tsx` - replace the placeholder with your implementation
3. Use the props interface (toolOutput, callTool, widgetState, etc.)
4. Use Tailwind CSS 4 utility classes for all styling (enterprise UI patterns welcome)
5. Add translations to `locales/en-US.json`, use `useTranslation()` hook
6. Write tests in `src/__tests__/components/main-component.test.tsx`
7. Run `npm test && npm run type-check && npm run lint && npm run build` before completing

## Template Structure

```
src/
├── main.tsx              # Entry point (wraps with AppsProvider) - DO NOT MODIFY
├── App.tsx               # Protocol wrapper (maps hooks to props) - DO NOT MODIFY
├── globals.css           # Tailwind CSS imports
├── components/
│   ├── main-component.tsx  # PRIMARY: Your implementation goes here
│   ├── layouts.tsx         # Display mode layouts (remove unused)
│   └── empty-state.tsx     # Empty state component
├── hooks/
│   └── use-translation.ts  # i18n hook
├── lib/                  # Protocol adapters (DO NOT MODIFY) - see src/lib/README.md
│   ├── apps-client/      # Protocol detection and adapters
│   └── apps-react/       # React hooks and context
├── __tests__/            # Test infrastructure
│   ├── setup.tsx         # Test setup (DO NOT MODIFY)
│   ├── matchers/         # Custom matchers (DO NOT MODIFY)
│   ├── test-utils/       # Render utilities (DO NOT MODIFY)
│   └── components/       # PRIMARY: Your component tests go here
└── vite-env.d.ts
locales/                  # Translation files (11 languages)
├── en-US.json           # English (REQUIRED - add new strings here)
└── ...                  # Other languages
references/              # Optional example files — read on demand
├── ref-display-mode-views.tsx  # Display mode view implementations
├── ref-test-patterns.tsx       # Test pattern examples
└── ref-server-handlers.ts      # Server handler examples
```

## Protocol Support

This template supports the **MCP Apps protocol** via the inlined library in `src/lib/`.

- Protocol is auto-detected at runtime
- DO NOT write protocol-specific code
- Use the abstracted props interface in MainComponent
- Mock adapter activates for local testing when no host is detected

**What NOT to modify:**

- Files in `src/lib/` are inlined from @mcp-apps-kit packages - DO NOT MODIFY
- Exception: `SimpleMcpApp` is our own code and can be modified for protocol updates

**License Gate — DO NOT MODIFY rules (P2a / T09):**

- `src/App.tsx` has ONE approved edit: the `<LicenseGate>` wrapper around `<MainComponent>`.
  Do **not** remove or weaken that wrapper — removing it breaks the revenue moat.
- Do **not** edit `src/lib/license.ts` — it contains the Ed25519 public key and
  gate logic. Changes here bypass or break the signature check.
- Do **not** edit `src/components/license-gate.tsx` or its sub-components
  (`TrialBanner`, `TrialExpiredScreen`, `LicenseRequiredScreen`).
- Do **not** edit the `<LicenseGate>` import line in `App.tsx`.
- The **only** file you should touch in `App.tsx` is `src/components/main-component.tsx`
  (the child of `<LicenseGate>`). All custom component logic lives there.

## Display Modes

The component should support these display modes:

- **inline**: Default small view in chat
- **inline-card**: Card-style inline view
- **fullscreen**: Full screen overlay
- **pip**: Picture-in-picture floating window

For example implementations, read `references/ref-display-mode-views.tsx`. Remove unused display mode views after implementation.

## Progressive Rendering (streaming tool input)

Hosts emit three UI notifications for each tool call:

1. `ui/notifications/tool-input-partial` — fires **0..N times** while the model is generating tool args. Each partial carries the **full current args object** (not a delta). The host auto-closes unclosed JSON, but fields are frequently absent, arrays empty, nested objects `null`, and keys occasionally mid-transition between snake_case and camelCase.
2. `ui/notifications/tool-input` — fires once when args are final.
3. `ui/notifications/tool-result` — fires once when the server handler completes. `useToolResult()` populates here. This is the "streaming complete, UI safe to accept user input" signal.

`App.tsx` already subscribes to the partial stream via `useOnToolInputPartial` and synthesizes a `toolOutput` envelope (`{ _meta: { payload } }`) from each partial, so your `parsePayload()` handles streaming and final rendering uniformly. `isStreaming=true` on `MainComponentProps` means `!toolOutput && !!partialInput`.

**Two invariants every component must uphold:**

### A. Defensive parsing — `parsePayload()`

Every component implements a `parsePayload(toolOutput)` helper that returns a fully-defaulted view-model. No field read from a partial may reach JSX as `undefined` where `.map` / `.length` / `.toUpperCase` will be called on it.

Defaults: arrays → `[]`, objects → `{}` (or a typed shape if consumers need nested keys), strings → `''`, numbers → `0`, booleans → `false`. Dates stay `undefined` (host-authored single-writer rule — never synthesize `new Date()`).

### B. Read-only while streaming — `<fieldset disabled={isStreaming}>`

Partials re-fire many times per second. Any `<input value={data.x}>` whose value ties to streaming data has its content **wiped on every re-render** — the user types three letters, the next partial arrives, the input resets. A mutating click during streaming can send `sendFollowUpMessage` against a half-complete payload and corrupt host state.

Wrap the primary interactive region in `<fieldset disabled={isStreaming} className="contents">`. The fieldset natively disables every descendant `<button>`, `<input>`, `<textarea>`, `<select>` without per-control edits. For clickable non-button elements (divs/cards with `onClick`), gate the handler body: `if (isStreaming) return;`.

### Streaming indicator (required, non-invasive)

- Small pulsing-dot chip, `sticky top-2 right-2`, `role="status"`, `aria-live="polite"`, `pointer-events-none`.
- Plus `aria-busy="true"` on the root scroll container.
- Does NOT block content, does NOT overlay, does NOT reflow layout.
- Disappears the frame after `toolOutput` becomes defined.

### Rendering discipline during streaming

- Loading skeleton gates on `hasAnyRenderableData` (e.g. `data.items.length > 0 || !!data.title`), NOT on `!toolOutput`. First partial with any array entry or key field clears it (~1–3s, not 30–90s).
- Sections render behind `{data.X.length > 0 && (...)}` — never "No X yet" zero-state copy while streaming (causes flicker).
- Every `.map((x) => <Foo key={x.id} .../>)` derives `key` from a stable field with a fallback (`x.id ?? fallbackIndex`) and accesses nested fields defensively (`x.channel?.name ?? ''`).
- String interpolations: `{field && ` by ${field}`}` — never `by ${field}` (renders "by undefined").
- Don't use `<input defaultValue={data.x}>` either — `defaultValue` only reads on mount, and the component re-mounts when React keys change. If inputs must be populated from streaming data, copy into local `useState` in a `useEffect([toolOutput])` only when `!isStreaming`, then render `<input value={localX}>`.

### Self-review grep table

Run these checks in `src/components/**/*.tsx` before marking work complete:

| Pattern                                     | Expected                                    | Why                                            |
| ------------------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| `.map(`                                     | all preceded by `?? []` or `Array.isArray(` | `.map` on undefined throws                     |
| `toolOutput?.` chained without `??` inline  | 0                                           | Defensive parse happens once in `parsePayload` |
| `new Date().toISOString`                    | 0                                           | Host-authored timestamps only                  |
| `onClick={() => {}}`                        | 0                                           | No dead handlers                               |
| `function parsePayload` / `parseToolOutput` | ≥1                                          | Defensive helper is mandatory                  |
| `useOnToolInputPartial` in `App.tsx`        | 1                                           | Progressive rendering is default               |
| `<fieldset disabled={isStreaming}`          | ≥1                                          | Read-only during streaming                     |
| `<input value={data.`                       | 0 outside fieldset                          | Streaming-bound inputs must be disabled        |

**Reference:** `references/ref-progressive-rendering.tsx` has a full worked example including `parsePayload`, the disabled-fieldset pattern, the streaming indicator, and anti-patterns with explanations.

### Host capability flag

Hosts advertise `hostCapabilities.partialToolInput` (`useHostCapabilities()`). If absent, no partials are emitted and the component's behavior collapses to skeleton-until-tool-result. No code changes are needed — `useOnToolInputPartial` is a safe no-op on such hosts.

## Inline Viewport Budget (600px tall, scroll don't clip)

The host gives inline/inline-card iframes ~400–600px of height (`hostContext.containerDimensions.maxHeight`). **Every feature must remain fully usable at 600px tall** via internal scrolling — never by relying on the host to grow the iframe. Fullscreen is an opt-in enhancement, not an escape hatch.

**Banned in inline / inline-card code:**

- `min-h-screen`, `h-screen`, `100vh`, `100dvh` on any container (the iframe is not the browser viewport).
- Pixel heights > 560px on panels or forms (the primary action scrolls off-screen).
- **Modals, dialogs, and overlays.** They yank focus away from the row the user clicked, and the host's height-overflow guard pushes them ~⅓ down the iframe regardless of anchor. The legacy `ScrollableModal` primitive is retired; the canonical replacement is the non-modal `<ScrollablePanel>` (below). See `canonical/prompts/ui/briefing-learnings.md` §2.4 for the full retirement record.
- Primary action buttons (Submit / Save / Next) at the natural bottom of a tall content block without being sticky.

**Required patterns:**

1. **Scrollable root** — top-level container is `h-full overflow-y-auto`, or wrapped by `<InlineLayout maxHeight={viewport.height}>`. The template's `InlineLayout` and `InlineCardLayout` default `overflow-y: auto` on.
2. **Internal scroll + sticky footer** — use `<ScrollablePanel>` from `@agntux/ui-primitives` (sticky header + `flex-1 overflow-y-auto` body + sticky footer with the primary action). The same primitive serves both as the top-level layout for single-view handlers AND as the row-anchored expansion panel for list-view handlers — the difference is just where it's mounted and how its parent constrains its height.
3. **Sticky primary actions** — any form/wizard with a Submit/Next button places it in a `sticky bottom-0` footer inside the scroll container. ScrollablePanel's `footer` prop wires this for you.
4. **Sticky table headers** — data tables use a sticky `<thead>` so column labels stay visible as rows scroll.

**Reference:** `references/ref-scrollable-panel.tsx` has runnable examples for (a) scrollable list, (b) `<ScrollablePanel>` usage, (c) scrollable table with sticky header, (d) form with sticky submit.

**Tests:** every component's test suite must include a 600px budget check via `renderAtInlineViewport` from `src/__tests__/test-utils/viewport.ts`. Assert the root scroll container exists and that the primary action node is reachable via `scrollIntoView()`.

## Styling with Tailwind CSS 4

Use **Tailwind CSS 4 utility classes** for all styling. Build enterprise-grade UIs with standard HTML elements.

```tsx
{
  /* Button */
}
<button className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
  Submit
</button>;

{
  /* Badge */
}
<span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
  Active
</span>;

{
  /* Card */
}
<div className="rounded-lg border bg-card p-4 shadow-sm">
  <h3 className="text-sm font-semibold text-card-foreground">Title</h3>
</div>;

{
  /* Data Table */
}
<table className="w-full text-sm">
  <thead className="border-b bg-muted/50">
    <tr>
      <th className="px-3 py-2 text-left font-medium">Column</th>
    </tr>
  </thead>
  <tbody>
    <tr className="border-b hover:bg-muted/30">
      <td className="px-3 py-2">Value</td>
    </tr>
  </tbody>
</table>;
```

**Color classes — light-mode palette, works in any AI host:**

- Page: `bg-background text-foreground`
- Cards: `bg-card text-card-foreground border-border`
- Muted: `bg-muted text-muted-foreground`
- Buttons: `bg-primary text-primary-foreground` (blue), `bg-secondary text-secondary-foreground` (neutral)
- Danger: `bg-destructive text-destructive-foreground`
- Inputs & focus: `border-input`, `ring-ring`
- Status only: `text-green-600`, `text-amber-600`, `text-red-600`, `bg-green-50`, `bg-amber-50`, `bg-red-50` (narrow whitelist for badges/indicators)

**Anti-examples — do NOT use raw palette classes for structural elements:**

| Don't write                           | Use instead                                  |
| ------------------------------------- | -------------------------------------------- |
| `bg-white`                            | `bg-background` (page) or `bg-card` (panel)  |
| `bg-gray-50`, `bg-gray-100`           | `bg-muted` or `bg-secondary`                 |
| `text-gray-900`                       | `text-foreground` or `text-card-foreground`  |
| `text-gray-500`, `text-gray-600`      | `text-muted-foreground`                      |
| `bg-blue-600 text-white` (CTA)        | `bg-primary text-primary-foreground`         |
| `bg-red-600 text-white` (destructive) | `bg-destructive text-destructive-foreground` |
| `border-gray-200`, `border-gray-300`  | `border-border` or `border-input`            |
| `ring-blue-500`                       | `ring-ring`                                  |

Hard-coded palette classes bypass `useHostStyleVariables()` and make the component look identical on every host regardless of theme — the exact bug the semantic-token system was introduced to fix.

Do NOT write `getThemeFallbackCSS` functions, inject `<style>` blocks for colors, or use `dark:` variants.

## Localization (i18n)

All user-facing text MUST use the translation hook:

```tsx
import { useTranslation } from '../hooks/use-translation';

function MyComponent() {
  const { t } = useTranslation();
  return <button>{t('button.submit')}</button>;
}
```

**Adding new strings:** Add to `locales/en-US.json` with dot notation: `"category.key": "English text"`. Only add English translations by default.

## State Management

**toolOutput**: Read-only data from MCP tools — do not modify directly.

**widgetState**: UI-only state — keep under 4k tokens, never store sensitive data.

```tsx
const { widgetState, setWidgetState } = props;
setWidgetState({ ...widgetState, selectedTab: 'details' });
```

## Action Feedback Patterns

**Every user action must follow the lifecycle: idle → loading → success | error.** Users must see immediate, visible feedback for every action they take.

### Per-Item State Tracking

For list/card UIs with actionable items, track state per item in widgetState:

```tsx
// In widgetState: itemStates: Record<string, ItemActionState>
interface ItemActionState {
  status: 'pending' | 'success' | 'error';
  isSending: boolean;
  error?: string;
}
```

### Required Feedback Per Action

Every action button that triggers `sendFollowUpMessage` or `callTool` must implement:

- **Loading**: Button shows spinner and is disabled while processing (`isSending: true`)
- **Success**: Visible confirmation appears — status badge change (amber→green), confirmation text, or visual de-emphasis (reduced opacity). Must be visible without scrolling.
- **Error**: Inline error message near the failed action, button re-enabled for retry

### Handler Pattern

```tsx
const handleAction = async (itemId: string) => {
  // 1. Set loading state FIRST
  setWidgetState((prev) => ({
    ...prev,
    itemStates: {
      ...prev.itemStates,
      [itemId]: { status: 'pending', isSending: true, error: undefined },
    },
  }));
  try {
    // 2. Perform action
    await sendFollowUpMessage(
      `Do the thing for item ${itemId}. Do not add any commentary after completing the update.`,
    );
    // 3. Optimistic success
    setWidgetState((prev) => ({
      ...prev,
      itemStates: {
        ...prev.itemStates,
        [itemId]: { status: 'success', isSending: false },
      },
    }));
  } catch (err) {
    // 4. Show error inline
    setWidgetState((prev) => ({
      ...prev,
      itemStates: {
        ...prev.itemStates,
        [itemId]: {
          status: 'pending',
          isSending: false,
          error: 'Action failed. Please try again.',
        },
      },
    }));
  }
};
```

## Bundle Size Optimization

After implementation, remove unused code:

1. Remove unused display mode views from `main-component.tsx`
2. Remove unused layouts from `layouts.tsx`
3. Remove unused component files
4. Remove unused imports

Target: < 200KB gzipped (current base: ~183KB gzipped)

## MCP Apps Compliance Checklist

- [ ] sendFollowUpMessage() used for all persisted state changes, email sends, and third-party mutations. Built-in tools are slug-prefixed per app (`{slug}_write_file`, `{slug}_read_file`, `{slug}_edit_file`, `{slug}_prepend_file`, `{slug}_list_files`, `{slug}_send_email`) and are host-only — the component NEVER calls them via callTool. Hydrate initial state from `useToolResult()`, not by reading files.
- [ ] Component adapts layout for display mode (inline-card vs fullscreen)
- [ ] Optimistic/updating UI state shown during write-back operations
- [ ] Every user action has loading, success, and error feedback visible without scrolling
- [ ] No direct fetch() to external APIs (sandboxed iframe constraint)
- [ ] Semantic Tailwind color classes used for all colors (bg-background, text-foreground, etc.)
- [ ] All user text via useTranslation() hook

## Quality Checklist

Before completing work:

- [ ] `npm test` passes (all tests green)
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] All user text uses `useTranslation()`
- [ ] Empty states handled
- [ ] Error states handled
- [ ] Loading states handled (skeleton gates on `hasAnyRenderableData`, not on `!toolOutput`)
- [ ] Progressive rendering: `useOnToolInputPartial` wired in `App.tsx`, `parsePayload` defaults every field
- [ ] Interactive controls disabled while `isStreaming=true` (`<fieldset disabled={isStreaming}>` or equivalent)
- [ ] Streaming indicator is non-invasive (does not block or overlay content; `role="status"`, `aria-live="polite"`)
- [ ] Accessibility requirements met (ARIA labels, keyboard nav, `aria-busy` during streaming)
- [ ] No sensitive data in widgetState
- [ ] Unused code removed

## Build Commands

```bash
npm run dev          # Start dev server
npm run build        # Build for production (outputs to out/)
npm run type-check   # Run TypeScript type checking
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

## Testing

### Running Tests

```bash
npm test              # Run all tests once
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

### Test Utilities API

**`createMainComponentProps(options)`** - Create props for MainComponent with spies:

```tsx
const {
  props, // Props to pass to <MainComponent {...props} />
  callToolSpy, // vi.fn() for asserting callTool calls
  setWidgetStateSpy, // vi.fn() for asserting setWidgetState calls
  requestDisplayModeSpy, // vi.fn() for asserting requestDisplayMode calls
  getWidgetState, // () => current widget state after updates
} = createMainComponentProps({
  toolOutput: { data: 'value' },
  widgetState: { count: 0 },
  displayMode: 'inline',
  theme: 'light',
  locale: 'en-US',
});
```

**`renderWithProvider(ui, options)`** - Render with AppsProvider context:

```tsx
const { adapter } = renderWithProvider(<MyHookComponent />, {
  adapterOptions: {
    initialToolOutput: { data: 'test' },
    initialWidgetState: { count: 0 },
  },
});

adapter.emitToolResult({ data: 'updated' });
adapter.setHostContext({ locale: 'es-ES' });
adapter.mockToolResponse('my_tool', { result: 'mocked' });
```

### Custom Matchers

```tsx
expect(adapter).toHaveCalledTool('my_tool');
expect(adapter).toHaveCalledTool('my_tool', { arg: 'value' });
expect(adapter).toHaveWidgetState({ count: 5 });
expect(container.firstChild).toBeAccessible();
```

### Mapping testCases to Tests

Each ticket in prd.json has a `testCases` array. Write tests that verify these cases:

| prd.json testCase                           | Test Implementation                              |
| ------------------------------------------- | ------------------------------------------------ |
| "Temperature renders from toolOutput"       | `it('renders temperature from toolOutput', ...)` |
| "Empty state shows when no data"            | `it('shows empty state when no data', ...)`      |
| "Refresh button calls weather.refresh tool" | `it('calls weather.refresh on click', ...)`      |

For complete test examples, read `references/ref-test-patterns.tsx`.

### Test Checklist

- [ ] All tests pass (`npm test`)
- [ ] Tests cover all display modes used by the component
- [ ] Tests cover empty/error states
- [ ] Tests cover user interactions (button clicks, form submissions)
- [ ] Tests verify tool calls with correct arguments
- [ ] Tests verify widget state updates
- [ ] No accessibility violations (buttons have names, images have alt text)

## Server-Side Tool Handlers

Server-side tool handlers run on the backend and provide MCP tools with access to secrets and external APIs.

### Where to Write Handlers

Place each handler in `server/tools/{tool-name}.ts`. Use kebab-case for file names:

```
server/
├── index.ts              # Exports all handlers by tool name
├── types.ts              # ToolHandler and ToolContext types
├── tools/
│   ├── _example.ts       # Example handler (delete when adding real ones)
│   └── your-tool.ts
└── __tests__/
    └── your-tool.test.ts
```

### How to Export

Add a named export in `server/index.ts` matching the tool name exactly:

```typescript
export { handler as weather_get_current } from './tools/weather-get-current.js';
```

### Handler Signature

```typescript
import type { ToolHandler } from '../types.js';

export const handler: ToolHandler = async (input, context) => {
  const apiKey = context.secrets.MY_API_KEY;
  if (!apiKey) throw new Error('MY_API_KEY secret is not configured');

  const response = await fetch(`https://api.example.com/data?key=${apiKey}`);
  if (!response.ok) throw new Error(`API failed: ${response.status}`);

  return (await response.json()) as Record<string, unknown>;
};
```

### Context Object

```typescript
interface ToolContext {
  secrets: Record<string, string>; // API keys from app_secrets table
  appId: string;
  componentId: string;
}
```

For relay handler and mock handler examples, read `references/ref-server-handlers.ts`.

### Testing

Write tests in `server/__tests__/` using vitest. Mock `fetch` with `vi.fn()`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handler } from '../tools/weather-get-current.js';
import type { ToolContext } from '../types.js';

const mockContext: ToolContext = {
  secrets: { WEATHER_API_KEY: 'test-key' },
  appId: 'test-app',
  componentId: 'test-component',
};

describe('weather_get_current', () => {
  it('fetches weather data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ temperature: 72 }),
        ok: true,
      }),
    );

    const result = await handler({ city: 'Seattle' }, mockContext);
    expect(result).toEqual({ temperature: 72 });

    vi.unstubAllGlobals();
  });
});
```

### Key Rules

- Handlers have a **30-second execution limit**
- Handlers should be **pure functions** (input → output, no global state)
- `npm run build:server` bundles all handlers into `out/server-bundle.mjs`

## Test Data

For local testing, create `src/test-data.ts`:

```typescript
export function getTestData() {
  return {
    toolOutput: {
      // Sample data matching your component's expected structure
      items: [{ id: '1', name: 'Sample Item' }],
    },
    initialWidgetState: {},
  };
}
```

The mock adapter will use this data when no host protocol is detected.
