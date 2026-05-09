# State Management

This module focuses on component-side state patterns (widgetState,
optimistic updates, hydration from toolOutput) and the contract between
component and host. File-layout conventions (sigils, ordering, pagination,
scope rules) are owned by the plugin's SKILL.md and the host-side ingest
prompt — see your plugin's `skills/sync/SKILL.md` for the per-workflow
file schema.

## State Management (Summary)

**State Categories:**
1. **Business Data (toolOutput)** - Server truth, read-only, re-renders widget on update
2. **UI State (widgetState)** - Ephemeral, <4k tokens, for selections/filters/expanded panels
3. **Persistent (Cross-Session)** - Host-only file tools on every plugin's MCP server (slug-prefixed per app): `{slug}_read_file`, `{slug}_write_file`, `{slug}_edit_file`, `{slug}_prepend_file`, `{slug}_list_files`. Files persist across conversations, scoped per user per workflow. **The component NEVER calls file tools.**
4. **User-Scoped (Cross-Workflow)** - Same file tools with `scope: "user"`. Host-only. Shared across all workflows: tasks.md, preferences.md (`## Identity` + `## Shared behavior`), MEMORY.md, installed-workflows.md.
5. **Email (Outbound)** - Host-only `{slug}_send_email` tool on every plugin's MCP server. Supports to/cc/bcc, HTML formatting. Reply-to defaults to user's email from user `preferences.md` → `## Identity`. **The component NEVER calls send_email.**

**Critical Rules:**
- Never store passwords, API keys, or sensitive PII in widgetState
- widgetState must stay under 4k tokens
- toolOutput is read-only - call callTool() to update server data
- Components NEVER call the 5 file tools or the email tool. For any state change or email intent, update local React state optimistically and emit `sendFollowUpMessage`; the host performs the file write or sends the email.
- File paths are simple (e.g., "tasks.md") — the server handles user/workflow scoping

**Localization:** All text must use `useTranslation()` hook. Default to English-only.

**Preference hydration pattern.** On mount the component reads each preference's default from the tool payload (`appPreferences.ui_defaults.X` for app-scoped UI defaults, `userPreferences.identity.X` for user-scoped identity, etc.) and seeds widgetState via `useWidgetState('X', defaultFromPayload)`. After mount, widgetState is the source of truth until the next tool call; a fresh render re-seeds from freshly-read preferences. Every discoverable preference declared in Section 14A (a) must document this wiring in the spec — payload source field, widgetState key, and re-render behavior.

## State Management Patterns

**State Categories:**

1. **Business Data (Authoritative)**: Stored on MCP server/backend
   - Source of truth for all data
   - Returned in `structuredContent` from tool responses
   - Widget re-renders when tool completes with new data
   - Read via `useToolResult()` hook

2. **UI State (Ephemeral)**: Stored in widget using `useWidgetState()` hook
   - Selected items, expanded panels, sort order, filters
   - Scoped to specific widget instance (message_id/widgetId)
   - Persists only for that widget instance
   - Re-applied when server data refreshes
   - **CRITICAL: Must stay under 4k tokens** (sent to model)
   - Read/write via `useWidgetState()` hook

   **What does NOT belong in widgetState — use plain `useState` instead:**
   - Modal open/close flags (`editingId`, `isCreateOpen`, `showConfirm`)
   - Input values in an unsaved form — commit to widgetState only on save (or directly via `sendFollowUpMessage`)
   - Transient per-action loading/error flags that pair with a single button click

   **Rule of thumb:** if the state should reset cleanly when the host re-renders the widget with fresh tool output, it belongs in `useState`. If it should persist across re-renders (filter selections, sort order, which rows the user has expanded, "hide done" toggle), it belongs in `widgetState`. When in doubt, prefer `useState` — widgetState costs model tokens and every extra field makes the 4k budget tighter.

   **widgetState vs. sticky defaults.** widgetState holds the CURRENT value of a control in this specific rendered widget. It resets if the host re-renders. A persistable DEFAULT for that same control (e.g., `hide_done_default: true` so every new render starts with done hidden) lives in app-scoped `preferences.md` under `## UI defaults`. The component seeds widgetState from `appPreferences.ui_defaults` on mount; after that, the widget's toggle writes to widgetState only. The default is only persisted when the user says "always," "by default," "from now on," or taps an explicit "make this my default" affordance. See "Preference capture classification" below.

3. **Persistent State (File-Based, Cross-Session)**: 5 built-in file tools on every plugin's MCP server, slug-prefixed per app
   - `{slug}_read_file`, `{slug}_write_file`, `{slug}_edit_file`, `{slug}_prepend_file`, `{slug}_list_files`
   - **Host-only.** The generated component NEVER calls these tools. Only the AI host (Claude in conversation) and scheduled tasks (Claude via Cowork) invoke them.
   - Files persist across conversations, scoped per user per workflow.
   - Each workflow's SKILL.md defines its own file structure and specifies, per user action, which file operation the host should perform.
   - Max file size: 500KB per file. Files auto-trim when approaching 400KB — oldest lines are removed from the end.
   - Paths are simple (e.g., "tasks.md", "handled.md") — the server handles user/workflow scoping.

   **Security:** Same rules as widgetState — never store passwords, API keys, or sensitive PII.

**File-Tool Error Semantics (the host must know these to recover cleanly):**

| Tool | Missing path | Existing path |
|------|--------------|---------------|
| `{slug}_write_file` | creates | **throws** — use `{slug}_edit_file` for updates |
| `{slug}_read_file` | returns `{ found: false }` | returns content — non-throwing, safe to probe |
| `{slug}_edit_file` | throws — use `write_file` with initial content | applies edit |
| `{slug}_prepend_file` | creates then prepends | prepends — valid first-write for newest-first logs |
| `{slug}_list_files` | returns `[]` | returns listing |

For file-layout conventions (format, sigils, ordering, pagination, scope rules) see the plugin's `skills/sync/SKILL.md`. The component never reads or writes those files; the contract here is only the *shape* of the payload the host hands back through `toolOutput`.

**Two Actors Manage Files (both are the host):**

**Host-managed (Claude in conversation):**
- Claude calls the app's slug-prefixed file tools as MCP tools.
- Use for: data the host processes during conversation (watermarks, processing logs, preferences captured from natural language or "make this my default" affordances), AND any UI-initiated state change surfaced through `sendFollowUpMessage`.
- Example: Claude reads `watermark.md` for last-checked timestamp, fetches new data from a connector, then prepends an update and edits the watermark. Claude also writes to app `preferences.md` → `## Behavior` when the user says "always CC Alice" or similar.

**Scheduled-task-managed (Claude via Cowork recurring tasks):**
- Cowork scheduled tasks run automatically on a cadence (e.g., hourly).
- Same tools as interactive host.
- Use for: proactive data caching, heartbeat updates, background processing.

**The generated component is never a file actor.** When a UI event should change persisted state, the component:
1. Updates its local React state immediately (optimistic UI)
2. Emits `sendFollowUpMessage(<natural-language intent>)` describing the change
The host receives the message, performs the appropriate file tool call per the SKILL.md, and — for silent-persistence messages — returns NO further tool calls and NO assistant text.

## User-Scoped Files

In addition to workflow-scoped files (per user, per app), the file tools support **user-scoped files** that are accessible across all workflows. Use the `scope: "user"` parameter on any file tool to read/write user-scoped files. Host-only, same as workflow-scoped files.

**User-scoped file layout (platform-canonical):**
- `MEMORY.md` — cross-workflow user facts and feedback (types: `user`, `feedback`)
- `installed-workflows.md` — auto-maintained registry of installed workflows (host-only context; not passed to the component)
- `scheduled-task-prompt.md` — compiled heartbeat prompt for Cowork
- `heartbeats.md` — log of heartbeat runs (newest-first)
- `tasks.md` — cross-workflow task list (any workflow can read/write)
- `preferences.md` — cross-workflow preferences with `## Identity` (email, timezone) and `## Shared behavior` (writing_style, signature, meeting_days) subsections

Note: the legacy user-scoped `config.md` has been retired. Identity and cross-workflow preferences now live under the two subsections of user-scoped `preferences.md`.

**Rules:**
- Read established user-scoped files freely.
- Write to a user-scoped file only when following its canonical schema.
- Do not invent new user-scoped files; flag for platform approval if a new schema is genuinely needed.

## Email (Built-in)

The `{slug}_send_email` tool is built-in on every plugin's MCP server (like file tools). **Host-only — the component never calls it directly.**

**Parameters:** `to` (string), `subject`, `html` (rich body), `text` (plain text fallback), optional `cc` (array), `bcc` (array), `reply_to` (string). For multiple primary recipients, use `cc` or `bcc`. Max 50 total recipients.
**From address:** Always `"{userName} via AgntUX <workflows@agntux.ai>"` — not configurable (prevents spoofing).
**Reply-to:** Defaults to the user's email from user-scoped `preferences.md` → `## Identity`. Override with `reply_to` parameter.
**Auth:** Requires authenticated user (same as file tools).

**Two Ways Email Gets Sent (both go through the host):**

**Host-initiated (conversation or scheduled task):**
- Claude composes the email and calls the email tool directly.
- Use for: report summaries, alert digests, scheduled briefings.

**UI-initiated (component → host via sendFollowUpMessage):**
- Component calls `sendFollowUpMessage(...)` describing the email intent (recipient, subject, content or source, any formatting guidance).
- Host drafts the final HTML/text and calls the email tool.

**Config dependency:** The user's email must be in user-scoped `preferences.md` under `## Identity` for reply-to to work. Format: `email: user@example.com`.

**Privacy: Use BCC for large distribution lists** where recipients should not see each other's email addresses.

## How UI-Initiated State Changes Flow

There is a single pattern for changes originating in the UI. The component never touches files — it updates its own React state optimistically and notifies the host, which performs the file operation.

**The Pattern: optimistic local state + `sendFollowUpMessage`**

1. The user does something in the UI (checks off a task, renames an item, reorders a list).
2. The component updates its local React state synchronously. The UI reflects the new state immediately.
3. The component calls `sendFollowUpMessage(<natural-language intent>)` describing what happened.
4. The host receives the message and, per the SKILL.md, calls the appropriate file tool(s).
5. For silent-persistence changes (UI-only; no connector or compute needed), the host stops after the file write: no render tool, no assistant text. The component's optimistic state is the canonical UI.
6. For compound changes (require a third-party connector or LLM-generated content), the host executes the connectors, performs any file writes, and may re-render. The component shows a loading indicator until the host responds.

```typescript
// Silent persistence — user checks off a task
const handleCompleteTask = async (taskId: string) => {
  // 1. Update local state first
  setTasks(prev => prev.map(t => t.id === taskId ? { ...t, done: true } : t));
  // 2. Notify host — fire and forget
  await sendFollowUpMessage(
    `The user marked task ${taskId} as done. Please update tasks.md accordingly.`
  );
};

// Compound action — user files a Jira ticket from the UI
const handleFileTicket = async (error: ErrorData) => {
  setFilingId(error.id); // local loading state
  await sendFollowUpMessage(
    `Create a Jira ticket for error ${error.id}: title="${error.title}", priority=${error.severity}. ` +
    `After creating the ticket, record the mapping in filed.md.`
  );
  // Host will re-render with updated data
};
```

**Hydration on mount:** When the component first renders, the tool-call payload already contains the current state (the host called `{slug}_read_file` in Step 0 before calling the render tool). Initialize React state from that payload. The component never reads files on mount.

```typescript
// GOOD — hydrate from toolOutput
const { toolOutput } = useToolResult();
const [tasks, setTasks] = useState(() => toolOutput?.tasks ?? []);

// DO NOT do this — components never call file tools
// callTool('{slug}_read_file', { path: 'tasks.md' })
```

**Why this pattern:**
- **No jarring re-render.** The UI updates on click; the host writes silently.
- **Single writer.** Only the host writes files, so schema invariants the component depends on cannot drift.
- **Deterministic hydration.** Next conversation's Step 0 re-reads the file and passes fresh data in — the component never needs to reason about staleness mid-session.

**Preferences hydration (Step 0 payload):** When the app-spec declares any preference in Section 14A, the render tool's `outputStructure` MUST include TWO objects the component reads, plus one host-only field:

- `userPreferences` — the full contents of user-scoped `preferences.md`, parsed by subsection. Carries `## Identity` (email, timezone) and `## Shared behavior` (writing_style, signature, meeting_days, etc.). Read from `toolOutput?.userPreferences ?? {}`.
- `appPreferences` — the full contents of app-scoped `preferences.md`, parsed by subsection. Carries `## UI defaults` (component-consumed seeds) and `## Behavior` (host-consumed rules; the component may read these for display but the host is the primary consumer). Read from `toolOutput?.appPreferences ?? {}`.
- `installedWorkflows` — host-only delegation context. NOT exposed on the component-facing payload. Only the host reads this to resolve cross-app delegation targets.

If the spec declares Section 14A preferences but the render tool has no `userPreferences` + `appPreferences` slots, that is a dead-letter bug in the spec — surface it rather than papering over it by calling `read_file` from the component.

```typescript
const { toolOutput } = useToolResult();
const userPreferences = (toolOutput?.userPreferences ?? {}) as {
  identity?: { email?: string; timezone?: string };
  shared_behavior?: Record<string, unknown>;
};
const appPreferences = (toolOutput?.appPreferences ?? {}) as {
  ui_defaults?: Record<string, unknown>;
  behavior?: Record<string, unknown>;
};
const timezone = userPreferences.identity?.timezone ?? 'UTC';
// Values are already type-coerced by the host on hydration (booleans / numbers
// arrive as proper JS types, not strings). Compare directly rather than Boolean()-wrapping.
const hideDoneDefault = appPreferences.ui_defaults?.hide_done_default === true;
const [hideDone, setHideDone] = useWidgetState('hideDone', hideDoneDefault);
```

## Preference capture classification

Every user utterance that touches behavior is either persistent (writes to `preferences.md`) or ephemeral (stays in widgetState). The host uses these trigger words to decide:

**Persist** (write to the appropriate subsection of `preferences.md`, then STOP — no re-render, no assistant text):
- "always ..."
- "by default ..."
- "from now on ..."
- "make this my default"
- "hide done by default"
- "every time, ..."

**Do not persist** (the change stays in widgetState for this widget instance only):
- "hide done" (without "by default" / "always")
- "sort by due date" (one-off view change)
- "show completed tasks" (transient filter)

When the component emits a "make this my default" affordance via `sendFollowUpMessage`, the envelope explicitly instructs the host to persist — the host does not re-classify.

**Subsection routing** (full decision tree lives in the plugin's `skills/sync/SKILL.md` under "Preference organization"):
- UI default → app `preferences.md` → `## UI defaults`
- Workflow-specific behavior rule → app `preferences.md` → `## Behavior`
- Cross-workflow shared preference → user `preferences.md` → `## Shared behavior`
- Identity (email, timezone) → user `preferences.md` → `## Identity`
- Free-form user fact → user `MEMORY.md` type `feedback`

**Dates and single-writer discipline (CRITICAL):**
Optimistic state is for fields the component authors: the user's form input (`title`, `priority`, `description`), toggles (`done`), and locally-minted IDs for silent-persistence entries (e.g., `t_abc123` for a task the host hasn't seen yet). Fields the HOST writes — any timestamp (`completedAt`, `createdAt`, `updatedAt`, anything ending in `At`/`_at`/`_ts`) and any ID returned by a compound action (Jira ticket key, Slack message TS, HubSpot record ID) — must stay `undefined` in local state after an optimistic change. Never call `new Date()`, `Date.now()`, or `toISOString()` to synthesize a value the host will persist. The host's clock is canonical; if both the component and the host stamp the same field, the two values drift at timezone boundaries and the component never re-reads the file mid-session to reconcile.

```typescript
// GOOD — host stamps the date; component leaves it undefined until rehydration
setTasks(prev => prev.map(t => t.id === id ? { ...t, done: true, completedAt: undefined } : t));
await sendFollowUpMessage(
  `User marked @id:${id} done. Flip "- [ ]" to "- [x]" and add @completed with today's date. Do not add any commentary after completing the update.`
);

// BAD — component synthesizes a timestamp the host will overwrite
const today = new Date().toISOString().split('T')[0];
setTasks(prev => prev.map(t => t.id === id ? { ...t, done: true, completedAt: today } : t));
```

If the UI needs a "just now" indicator while the host catches up, compute it at render time from `done && !completedAt` — do not persist a synthesized value.

**State Flow Patterns:**
- Business data: User action → Widget calls `useAppsClient().callTool()` → Server updates data → Server returns `structuredContent` → Widget re-renders
- UI state: UI interactions → `useWidgetState()` hook → State persists → Re-applied on re-render
- Persistent file (silent): Component updates local state → `sendFollowUpMessage(...)` → Host calls file tool → Host returns nothing (no tool call, no text) → Component stays as it optimistically drew
- Persistent file (compound): Component shows loading → `sendFollowUpMessage(...)` → Host calls third-party tool + file tool → Host re-renders with updated payload → Component updates

**Security Guidelines:**
- **DO NOT store in widgetState:**
  - Passwords, API keys, secrets
  - Sensitive PII (SSN, credit cards, etc.)
  - Large datasets
  - Raw unvalidated user input
- **DO store in widgetState:**
  - UI preferences (filters, view mode, selections)
  - Temporary selections (expanded panels, selected items)
  - Small, non-sensitive metadata

---

## Localization (i18n) Requirements

**CRITICAL: All user-facing text must use the `useTranslation()` hook. Never hardcode strings.**

**Default: English-Only Components**
- By default, create components with English-only translations
- When adding new strings, add the key to `locales/en-US.json` with the English translation
- **Only add English translations by default** - do not generate translations for other languages unless explicitly requested
- The template automatically detects locale from host context and falls back to English if other languages are not available

**Translation System:**
- Hook: `useTranslation()` from `src/hooks/use-translation.ts`
- Locale files: `locales/*.json` contain translations
- Source of truth: `locales/en-US.json` defines all translation keys
- Automatic detection: Locale is read from host context

**Translation Key Naming:**
- Format: `category.key` (e.g., `button.submit`, `error.loadFailed`, `label.username`)
- Categories: `button.*`, `label.*`, `error.*`, `status.*`, `welcome.*`, etc.

**Parameter Substitution:**
- Use `{{key}}` syntax in translations: `"welcome.message": "Hello {{name}}"`
- Usage: `t('welcome.message', { name: 'John' })`
