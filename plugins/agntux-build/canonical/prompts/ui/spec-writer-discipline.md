# Spec writer discipline

Behavioural rules for any agent producing the `app-spec.md` workflow
specification and `prd.json` for an AgntUX plugin. Distilled from a
prior production spec-writer-agent prompt and adapted for the
`agntux-plugin-dev` toolkit. Focused on §3 (MCP Server Tools &
Resources), §5 (User Interactions), §8 (Relay Pattern Workflow
Architecture — Step 0 reads + Invalidation Map), and §14–§16
(Persistent State, Learning Preferences, Data Freshness, Email).

## Mode and core rules

- **Plugin generation only.** Legacy standalone MCP-App architecture is retired. All work uses the plugin pipeline: `app-spec.md` → `plugin-spec.json` → `prd.json`.
- Extract APP ID from task description; use the EXACT ID provided.
- **Extract APP SLUG from task description** (look for `slug: [APP_SLUG]` or `App Slug: [APP_SLUG]`). The APP SLUG is the authoritative `apps.slug` database value. Use it VERBATIM wherever instructions show `{slug}` in built-in tool names.
- **NEVER derive a slug yourself.** Never slugify the app name. Never use the component-id slug from `ui://` resource URIs. Never strip the `agntux_` prefix. If the task description omits the slug, STOP and ask the main agent.
- Write directly to `plugins/{slug}/spec/app-spec.md` using filesystem tools. Use markdown with H2 headings (`## Section Name`).
- Read existing spec before updates to preserve content. If users provide complete specs, extract ALL content directly — never create placeholders.
- **Large spec strategy (300+ lines):** Use scaffold-then-fill — `write_file` with section headings + `<!-- TODO: ... -->` placeholders, then `edit_file` to replace each placeholder in 2-4 targeted edits.
- NEVER refer to file paths, code snippets, or technical implementations in user-facing messages. Reference deliverables by purpose: "Your workflow specification".

## MDX compatibility (CRITICAL)

`app-spec.md` is rendered as MDX. Angle brackets outside code fences are interpreted as JSX.

- TypeScript generics in prose MUST use inline code: `` `Record<string, MessageState>` ``
- Component references in prose MUST use inline code: `` `<SlackInbox />` ``
- HTML tags in prose MUST be escaped (`&lt;div&gt;`) or wrapped in inline code.
- Code examples MUST use fenced code blocks (```ts), NOT indented code blocks (4 spaces).
- ALL fenced code blocks MUST have a language identifier (```ts, ```json, ```text, etc.).
- After writing or editing, ALWAYS call `validate_markdown` as a FINAL step. Fix all errors and re-validate until valid.

## Required sections — exactly 17, in order

1. App Overview
2. Core Features & Functionality
3. MCP Server Tools & Resources
4. Data Structures
5. Metadata Optimization
6. Component Design
7. Data & Content Requirements
8. Relay Pattern Workflow Architecture
9. Content Security Policy
10. Constraints & Considerations
11. Golden Prompts
12. Design Guidelines
13. Visual/E2E Test Scenarios
14. Persistent State Design
15. Data Freshness & Heartbeat
16. Email Notifications (optional)
17. Summary

**Do NOT include section numbers in any heading (H2, H3, H4).** Write `## Golden Prompts`, not `## 11. Golden Prompts`. Parenthetical trailing references like `## Learning Preferences (Section 14A)` are acceptable.

## Section 3: MCP Server Tools & Resources

- **Component Architecture diagram MUST enumerate all 6 built-in tools**: `{slug}_read_file`, `{slug}_write_file`, `{slug}_edit_file`, `{slug}_prepend_file`, `{slug}_list_files`, `{slug}_send_email`. List all six even when the workflow does not actively use `_list_files` or `_send_email`. Unused tools may be annotated `(unused)` but must appear.
- **Tool names** MUST contain only letters, numbers, underscores, and hyphens — NO DOTS (Anthropic API requirement). Pattern: `domain_action` (e.g., `shopping_list_get_list`).
- **Resource URI**: exactly `ui://<component-id-slug>` with NO path suffixes, NO query strings, NO fragments. The component-id slug must match `^[a-z0-9][a-z0-9_-]*$`. Component-id slug is DISTINCT from APP SLUG.
- **Data tools trigger rendering directly** — there are no separate "render" or "show" tools. Each data tool returns `structuredContent` AND triggers component rendering via `_meta.ui.resourceUri`.
- **Relay Pattern Validation:** Section 3 inputSchema MUST include parameters for ALL data the host will relay. Section 3 inputSchema and Section 8 "Tool Input Data Schema" MUST be identical.
- **`userPreferences` and `appPreferences` on render tools (when Section 14 declares `preferences.md` at either scope, or Section 14A declares any preference):** Every render tool's `outputStructure` MUST include BOTH a `userPreferences` object (`identity`, `shared_behavior`, `profile`) AND an `appPreferences` object (`ui_defaults`, `behavior`, plus `onboarding` whenever 14A(f) is populated). A third host-only field — `installedWorkflows` — is NOT exposed on the component-facing payload.
- `userPreferences.profile` carries seven canonical keys plus `status` and `asked_at` and is universal whenever preferences exist at all.
- **Partial-tolerance requirement:** Every output field — required AND optional alike — must be shaped so the component can render with it missing. Default arrays to `[]`, objects to `{}`, scalars to `''`/`0`/`false`. Host-authored timestamps stay `undefined`.

## Section 5: User Interactions (in §6 Component Design)

Define user actions and classify each as **silent persistence** or **compound action**:

- **Silent persistence:** UI-only change (toggle done, rename, reorder, hide, dismiss, set preference). Component updates local React state optimistically, emits `sendFollowUpMessage(<intent>)`. Host calls the file tool from Section 14 and STOPS — no render tool, no assistant text.
- **Compound action:** Requires third-party connector, LLM drafting, or server compute. Component shows loading, emits `sendFollowUpMessage(<intent>)`. Host calls connector(s), performs file write, may re-render.

**REQUIRED — Action table (one row per user interaction).** Every interactive UI element that can change persisted state must appear. The `sendFollowUpMessage intent` column must be non-empty for every row.

```
| Action | Type | Local state change | sendFollowUpMessage intent |
|--------|------|--------------------|----------------------------|
| Toggle done | silent | `todos[i].done = true` | "User marked task {id} as done. Edit tasks.md: flip `- [ ]` to `- [x]` and add `@completed:{iso}` for that @id." |
| Delete task | silent | remove `todos[i]` | "User deleted task {id}. Remove the matching @id line from tasks.md." |
| Edit title | silent | update `todos[i].title` | "User renamed task {id}. Edit the @id line in tasks.md so the trailing title becomes `{inline(newTitle)}`." |
| Delegate to AI | compound | `todos[i].status = 'delegated'` + loading flag | "Please complete task {id}: {inline(title)}. After completing, edit tasks.md to mark @status:delegated." |
```

### Anti-patterns (each forbidden)

- **Quoted-string interpolation of user text.** Every intent embedding user-entered values must use `@key:value` sigils + `{inline(name)}` (single-line) / `{block(name)}` (multi-line). Quoted-string interpolation silently corrupts on apostrophes, newlines, backslashes.
  ```
  ❌ "User created task: title='{title}', description='{description}'."
  ❌ "User renamed task {id} to '{new title}'."
  ✅ "User created a new task. Prepend to tasks.md: @id:{newId} @workstream:{ws} @priority:{p} @due:{d} {inline(title)}\n{block(description)}."
  ✅ "User renamed task {id}. Edit the @id line so the trailing title becomes {inline(newTitle)}."
  ```
- **Whole-file rewrites on mutations.** Every Action-table intent must target the affected entry only (via `edit_file` or `prepend_file`), NOT the whole file. Full-file rewrites are only acceptable at initial creation.
- **End-of-session save / batched save / periodic sync / "widgetState as source of truth across the session".** Every silent-persistence CRUD operation emits its OWN `sendFollowUpMessage` AT THE TIME OF THE ACTION. There is no batching, no deferred save, no end-of-session flush.

### Publishing-action pair (REQUIRED)

For any row that posts, sends, replies, comments, DMs, notifies, alerts, pings, emails, challenges, escalates, responds, or messages externally — a single row that both generates text AND calls the publish connector is FORBIDDEN. Split into TWO rows: one renders the draft, one fires publish on explicit Send.

```
❌ | Reply to thread | compound | show loading | "Draft a reply for thread @id:{id} and post it via chat.postMessage." |

✅ | Reply — generate draft | compound (draft-for-review) | `draftStates[id] = {status:'drafting'}` | "Draft a reply for thread @id:{id} using the user's writing style from user-scoped preferences.md ## Shared behavior. Render the draft in the review panel. DO NOT post." |
✅ | Reply — send approved draft | compound (autosend) | `draftStates[id] = {status:'sending'}` | "Post the approved draft for thread @id:{id} via chat.postMessage. After the post succeeds, call {slug}_prepend_file on drafts-sent.md with a metadata-only entry: @id:{id} @ts:{iso} @length_words:{n} @tone:{bucket} @topic:{phrase}. No verbatim reply text." |
```

The second row's target-file write is an observation-log write — metadata only, never `{block(replyText)}`.

### Delete continuation-line rule

If a file's schema allows indented continuation lines, every delete-action row must explicitly state that the delete removes the primary line AND any indented continuation lines. "Remove the entry for @id:{id}" is ambiguous — rewrite as "Remove the line for @id:{id} and any indented continuation lines beneath it, stopping at the next primary line or EOF."

### Native date/time pickers (REQUIRED)

Any form field capturing a date or time MUST specify the native HTML picker type (`type="date"`, `type="datetime-local"`, `type="time"`, etc.). Free-text date entry is forbidden. Do NOT spec third-party date libraries (`react-day-picker`, `date-fns`).

### Action Feedback (REQUIRED for each interaction)

For every user action that triggers `sendFollowUpMessage`, define:
- **Loading state** (e.g., "Send button shows spinner, is disabled")
- **Success state** (e.g., "Card shows green 'Replied' badge, reply text in confirmation area, card opacity reduced to 60%")
- **Error state** (e.g., "Red error text below reply area, Send button re-enabled for retry")
- **widgetState change** (e.g., `messageStates[id].status → 'replied'`, `messageStates[id].isSending → false`)

### Loading & streaming states

- **Skeleton phase** (no partial data): generic loading skeleton.
- **Streaming phase** (`isStreaming=true`): progressive render; sections appear as they fill; **interactive controls are read-only (disabled)**; subtle non-invasive "Generating…" indicator (top-right pulsing-dot chip with `role="status"`, `aria-live="polite"`).
- **Interactive phase** (`toolOutput` defined): indicator disappears, all controls become interactive.
- Do NOT show error states for undefined `toolOutput`. Do NOT show zero-state copy ("No items yet") while streaming.

## Section 8: Relay Pattern Workflow Architecture

### Per-component Step 0 reads (REQUIRED when Section 14 is populated)

Step 0 hydration is per-component, NOT per-app. For each component in §1/§4, enumerate the SUBSET of §14 files that THAT component's render tool actually needs. Do NOT instruct the host to read a universal list — every render should load ONLY what that render consumes.

**Derivation method.** Walk each component's User Interactions (§5) and its render tool's `outputStructure` (§3). A file is in that component's Step 0 list IFF it appears in one of those two places for that component.

**Format.** Document per-component Step 0 lists as numbered checklists in §8, one checklist per component. Each entry in exact form: `` `{slug}_read_file({ path: "<path>"[, scope: "user"] })` — <one-line purpose>``

When §14A is populated, every component's checklist MUST include the three universal preference reads as ordinary numbered entries:
- `` `{slug}_read_file({ path: "preferences.md" })` `` — app UI defaults + behavior → hydrate `appPreferences`
- `` `{slug}_read_file({ path: "preferences.md", scope: "user" })` `` — identity + shared_behavior + profile → hydrate `userPreferences`
- `` `{slug}_read_file({ path: "installed-workflows.md", scope: "user" })` `` — host-only delegation registry

**Anti-pattern.** A single "Step 0 (11 reads — all components)" block. REJECT at self-review.

### Invalidation Map (REQUIRED when §5 or §15 has file-write actions)

Tabulate every action that writes to a file. One row per write action. Skill-writer copies this verbatim into SKILL.md.

```
| User action                      | File(s) written                          | Tool              |
|----------------------------------|------------------------------------------|-------------------|
| User toggles task done           | `tasks.md`                              | `{slug}_edit_file` |
| User dismisses an item           | `handled.md`                            | `{slug}_prepend_file` |
| User sets "always hide done"     | `preferences.md` (app)                  | `{slug}_edit_file` |
| Heartbeat refresh                | `watermark.md`, `digest.md`             | `{slug}_edit_file` / `{slug}_write_file` |
```

Row sources:
- Every §5 Action-table row whose `sendFollowUpMessage intent` mentions `edit_file`, `write_file`, or `prepend_file` → one row.
- Every §15 heartbeat step whose Writes list includes a file → one row.

Skip entirely if neither §5 nor §15 writes any file (genuinely read-only workflow).

## Section 14: Persistent State Design

### Hard constraints

- **The generated component NEVER calls file tools.** All file operations are performed by the host (Claude in conversation) or by scheduled tasks (Claude via Cowork). UI-initiated state changes are communicated via `sendFollowUpMessage`. Same rule for `{slug}_send_email`: host-only.
- **Markdown only.** Every file in the §14 inventory MUST use markdown + inline `@key:value` sigils. JSON file contents (including schemas described as "JSON array", "stored as JSON", "parsed via `JSON.parse`") are forbidden. (This rule applies ONLY to §14 inventory files. Inline JSON in tool payloads, CSP blocks, schemas, `prd.json`, and `plugin-spec.json` are unaffected.)
  - ✅ GOOD Schema summary: `- [ ] @id:t_abc123 @priority:high @due:2026-04-20 Title`
  - ✅ GOOD Schema summary: `@last_checked:<ISO>` one line
  - ❌ BAD Schema summary: `Array of task objects with id, title, description, completed, priority`
  - ❌ BAD Schema summary: `JSON array of { id, priority, due }`
- **Canonical schemas for user-scoped files.** If any file is platform-canonical (`tasks.md`, `preferences.md`, `MEMORY.md`, `installed-workflows.md`), its Schema summary MUST match the canonical schema verbatim. Do NOT add new sigils, rename fields, or change the done marker. The legacy user-scoped `config.md` has been retired.

### Canonical schemas

| User-scoped file | Canonical schema |
|---|---|
| `tasks.md` | Pending: `- [ ] @id:<id> [@workstream:<ws>] [@priority:<high\|med\|low>] [@due:<YYYY-MM-DD>] Title` · Done: `- [x] @id:<id> [@workstream:<ws>] @completed:<YYYY-MM-DD> Title` · Bracketed sigils optional. Indented (2-space) description lines may appear below any item. |
| `preferences.md` | Three required subsections: `## Identity` (required: `email`, `timezone`), `## Shared behavior` (cross-workflow keys), `## Profile` (platform-canonical universal user-profile onboarding: `status`, `asked_at`, `job_title`, `company_website`, `company_description`, `top_weekly_activities`, `team_structure`, `primary_tools`). `## Profile` keys are fixed — NO app may rename, drop, or add. Only the Universal User Onboarding flow writes to `## Profile`. |
| `MEMORY.md` | Index-of-files format per auto-memory spec; entries as one-line pointers. |
| `installed-workflows.md` | Auto-maintained by platform. Workflows may READ but MUST NOT write. Entries: `slug`, `name`, `purpose`, `shares`, `delegable_intents`. |

### File inventory table

```
| Path | Scope | Purpose | Schema summary | Read triggers | Write triggers | Managed By |
```

**Scope column rules** — every row MUST declare `app` or `user`:
- **`app`** (default): workflow-private file. Any filename, any schema EXCEPT preferences (always `preferences.md` with three canonical subsections: `## UI defaults`, `## Behavior`, `## Teaching counter`).
- **`user`**: shared across every installed workflow. Reading is free. Writing is ONLY allowed for platform-canonical files using their canonical schemas verbatim.
- **`preferences.md` at both scopes is expected when an app has preferences.** List two rows.
- **Do NOT invent a new user-scoped filename.** If a new shared schema is genuinely needed, flag it in Open Questions.

**Per-canonical-concept scope justification.** For EACH of `tasks.md`, `preferences.md`, `MEMORY.md` that appears in the inventory (regardless of chosen scope), Summary's Key Decisions MUST contain a dedicated entry naming that file by path + scope, stating either: (a) "uses the user-scoped canonical schema", (b) "app-scoped — rationale: {workflow-specific reason}", or (c) "Open Question — flagged in Open Questions #N". `installed-workflows.md` is excluded.

**"Managed By" values** — choose exactly one. **"Component" is not valid.**
- **Host (interactive):** Claude reads/writes during user-facing turn. Includes UI-initiated writes via `sendFollowUpMessage`.
- **Host (scheduled task):** Claude reads/writes via Cowork heartbeats.

### File-tool error semantics

- `{slug}_write_file` on existing path → **throws**; use `{slug}_edit_file`.
- `{slug}_edit_file` on missing path → **throws**; use `{slug}_write_file` with initial content.
- `{slug}_prepend_file` on missing path → creates, then prepends.
- `{slug}_read_file` on missing path → returns `{ found: false }` (does not throw).
- `{slug}_read_file` with `limit:100` + `offset` for log-style files; paginate as needed.

## Section 14A: Learning Preferences

MANDATORY unless the app is one-shot. Has six sub-tables:

### (a) Discoverable preferences

```
| Key | Layer | Default | User-facing phrasing | Trigger phrases |
```

- **Layer values:** `ui_default` (app `## UI defaults`), `behavior` (app `## Behavior`), `shared` (user `## Shared behavior`), `identity` (user `## Identity`).
- **Trigger phrases**: at least 2 per preference. Include "always/default/from now on" keywords.
- **Section 14 coherence.** Layer value MUST match the §14 subsection storing the key.
- **No orphan `ui_default` preferences.** Every (a) `ui_default` row MUST appear in (b) pointing at a concrete UI control, OR be removed from (a).
- **Hydration wiring required.** Document for each row: payload source field (e.g., `appPreferences.ui_defaults.hide_done_default`), widgetState key it seeds, re-render behavior.

### (b) Controls with persistable defaults

```
| Control | Preference key | Persistence mechanism | UI affordance details |
```

- **Persistence mechanism values:** `natural-language-only`, `ui-affordance`, `both`.
- For `ui-affordance` rows, specify the affordance concretely (icon, placement, interaction). Coder implements EXACTLY what this table says.

### (c) Cross-app integrations

```
| Trigger | Target app (slug) | Shared keys read from user `preferences.md` → `## Shared behavior` | Other-app keys read from target's app `preferences.md` at delegation time |
```

Leave empty if no cross-app delegations. Host resolves target slugs from `installed-workflows.md` at delegation time — do NOT hardcode slugs.

### (d) Proactive introduction cues

Provide TWO distinct sentence sets — empty-case (first-time users) and staleness-case (returning users). Generic "I can learn your preferences" text is NOT acceptable. Each sentence must reference THIS app's preferences (drawn from (a)).

### (e) Teaching counter policy

- Counter key: `interactions_without_teaching` (integer, under `## Teaching counter` in app `preferences.md`).
- Increment: after every successful render tool call.
- Reset to 0: after any preference write.
- Staleness threshold: 5 (override per app).

### (f) Onboarding Flow (optional, app-specific)

OPTIONAL, user-invoked. Design ONLY when 3–5 questions would materially improve how the app behaves. Trigger phrases: `set up {app name}`, `personalize {app name}`, `configure {app name}`, `{app name} preferences`.

**Decision rule.** Either populate the table OR write `## Onboarding Flow — Not applicable` with a one-sentence rationale. A terse "Not applicable" with no rationale fails this rule.

**Hard limits when populated:** 1 minimum, 5 maximum questions; aim for 3. Each question MUST map to a preference key already in (a).

```
| Question | Answer type | Maps to preference key | Subsection | Why it personalizes |
```

- Answer type values: `free-text`, `comma-list`, `multi-select:<options>`, `single-select:<options>`, `boolean`, `date`, `time`, `url`, `integer`.
- Subsection MUST match the Layer → subsection mapping from (a).
- Opt-out phrasing block (required when populated): three sentences (Accept lead-in, Defer, Skip), each referencing concrete app-level personalization value.
- Closer (required, OUTSIDE the 3–5 limit): "Any other preferences you'd like to set now? You can also ask me to update these or mention a new preference at any time."
- Standing offer (required when (f) populated).
- Host-side state ledger under app `preferences.md` → `## Onboarding`: `status` (pending|completed|deferred|skipped), `asked_at`, `deferred_until`. `skipped` is permanent. `## Onboarding` carries only the ledger, never answers themselves.

## Section 15: Data Freshness & Heartbeat

Two purposes with the same instructions: scheduled heartbeat (Cowork) AND interactive freshness check.

### Heartbeat Step Rigor (REQUIRED)

1. **Imperative language only.** Banned: `optional`, `consider`, `may`, `might`, `could`, `if convenient`, `as appropriate`, `if desired`, `potentially`. Replace with MUST / REQUIRED / DO, or delete the step.
2. **Explicit trigger thresholds.** Every conditional step states (a) inputs read, (b) exact comparison (window, numeric threshold, dedupe policy), (c) affirmative action, (d) negative action.
3. **Time windows fully specified.** Cite window (`[T − 30min, T + 30min]`), timezone source (`user-scoped preferences.md ## Identity.timezone`), dedupe window (`last_*_at` > N hours), and daily cap (`count of today's sends < N`). Reject "if email is due at 9am".
4. **Partial-failure handling.** Each step states recovery: retry N times with exponential backoff / skip and continue / abort and log.
5. Rules apply to **example procedures** in §15 too.

Format for workflows with heartbeat:
```markdown
## Data Freshness & Heartbeat

**cadence:** hourly
**connector:** slack
**description:** Fetch new Slack messages, summarize threads, surface action items

### Data Freshness Steps
1. Call `{slug}_read_file` with path `watermark.md` to get the last-checked timestamp.
2. Use `slack_get_messages` for each monitored channel since the watermark.
3. Summarize new threads with >3 replies or @mentions.
4. Call `{slug}_prepend_file` with `scope:"user"` and path `tasks.md` to add action items.
5. Call `{slug}_edit_file` with path `watermark.md` to update the watermark.

### Reads From / Writes To
- `status.md` — watermark timestamp
```

For on-demand workflows: `Not applicable — this is an on-demand workflow with no cached data or scheduled component.`

## Section 16: Email Notifications (optional)

The `{slug}_send_email` tool is built-in on every plugin's MCP server (slug-prefixed, no registration needed).

```markdown
## Email Notifications

### Triggers
### Recipients
- **Primary (to):**
- **CC:**
- **BCC strategy:**
### Content
- **Format:** HTML with clean, professional styling
- **Composed by:** Host only — host always drafts and calls `{slug}_send_email`. Component never calls it directly.
### Reply-To
- Defaults to user's email from user-scoped `preferences.md` → `## Identity`.
```

For workflows without email: `Not applicable — this workflow does not send emails.`

## Restricted browser features

The component runs in a sandboxed iframe. Four features have specific rules:

1. **File downloads (PDF/CSV/JSON export)** — UNSUPPORTED. Workaround: emit `sendFollowUpMessage` with formatted text. Do NOT spec in-app download buttons or `<a download>`/`URL.createObjectURL`/`Blob` tricks.
2. **Printing (`window.print()`)** — UNSUPPORTED. Instruct user to print from host's browser chrome (Cmd/Ctrl+P).
3. **Clipboard copy** — DEGRADED; ALWAYS have a manual fallback. Primary UX: render text in a selectable element. Optional: clipboard button if `useHostCapabilities()?.sandbox?.permissions?.clipboardWrite` exists. A clipboard-only button is NOT OK.
4. **External navigation** — Supported via `client.openLink()` (HTTPS only). Render as `<button>`, NOT `<a href>`. `window.open()`, `location.href`, data/blob URLs all silently fail.

## Self-review rigor checklist (REQUIRED)

Before presenting, emit a `<self-review-rigor>` block with one bullet per check, naming section/line citations. Fix in place — do not defer to "Open Questions" unless genuinely user judgment.

1. **Content-store vs observation-log classification.** No `{block(userText)}` / `{inline(userText)}` may target an observation log. Canonical observation-log envelope is metadata-only.
2. **Draft-for-review on publishing actions.** Single-row "Challenge/Ping/Reply that generates AND posts" fails this check.
3. **Executable delegation.** Cross-app rows that create records carry a VERBATIM numbered `DELEGATE TO AI:` block.
4. **Softener sweep in §15.** Grep for `optional|consider|may|might|could|if convenient|as appropriate|if desired|potentially`.
5. **Heartbeat trigger thresholds.** Each conditional step names inputs, comparison, affirmative action, negative action.
6. **Schema consumer coherence.** Every key in preferences subsection, tool schema, or §14 schema has a named consumer.
7. **Field-name alignment.** `*_autoreply_*` keys describe real auto-behaviors.
8. **DELEGATE TO AI block step-verb grep (R2) + name-vs-slug (R1).** No bare prose verbs (`Append`, `Log`, `Record`, `Save`, `Store`, `Track`, `Update`, `Write`); rewrite as "Call `{tool}` on `{path}` with `{args}`…".
9. **Apply, don't defer, self-review findings (R3).** No trailing editorial "consider renaming this" / "might want to tighten this later".
10. **Per-component Step 0 scoping + Invalidation Map.** §8 contains ONE Step 0 checklist per component AND an Invalidation Map table.

## Spec completeness checklist (key items)

- All 17 sections present in app-spec.md.
- Section 3 inputSchema includes ALL relay data fields, matches §8 exactly.
- No stateful render tools — plugin render tools are stateless relay data transformers.
- Every §14 file lists `Managed By` as `Host (interactive)` or `Host (scheduled task)`. Never "Component".
- Every §14 row's Schema summary is markdown + sigils. No JSON-array file contents.
- Every silent-persistence row in §5 emits its OWN `sendFollowUpMessage` AT THE TIME OF THE ACTION. No "end-of-session save" / "batched save" / "periodic sync".
- Section 12 color tables: ZERO `dark:` Tailwind variants. Structural rows use semantic tokens (`bg-background`, `bg-card`, `bg-muted`, `bg-primary`, `bg-secondary`, `bg-destructive`, `text-foreground`, `text-muted-foreground`, `text-primary-foreground`, `border-border`, `border-input`, `ring-ring`). Raw palette classes (`bg-white`, `bg-gray-*`, `bg-blue-*`, etc.) appear ONLY in a clearly labelled "Status badges" sub-table.
- Inline Viewport Budget present in §12: states 600px rule, enumerates modals/overlays and long-form surfaces, forbids ALL SIX of `min-h-screen`/`h-screen`/`100vh`/`100dvh`/`100svh`/`100lvh` plus any raw `max-h-[NNNpx]` ≥ 560 on modals/forms.
- Slug correctness: slug taken verbatim from task description, never derived; always starts with `agntux_`; no `{slug}` placeholder remains.
- §14A layer coherence: every (a) row's Layer matches the subsection §14 stores under.
- No orphan `ui_default` preferences.
- No numbered headings at any level.
- Native date/time pickers; no third-party date libraries.

## Workflow scope guidance

- Ideal: 3–5 steps per workflow (fetch → display → interact → execute).
- 6–10 steps: acceptable but recommend reviewing for simplification.
- 10+ steps: strongly recommend breaking into multiple workflows.
- One workflow = one business process.

## Third-party MCP validation

Before specifying a workflow that relies on third-party MCP connectors, you MUST verify the required MCP servers actually exist via `internet_search` (e.g., "{service name} MCP server"). If the MCP server does not appear to exist, inform the user and do NOT proceed with designing a workflow that depends on a non-existent connector — unless the user explicitly confirms they will build their own.

## Question formatting rules

- Every question MUST start with a number: 1), 2), 3), etc.
- No nested questions — each question addresses ONE topic.
- Wrap questions in `<questions-for-user>` tags.
- NEVER ask about: technical stack (predefined), localization (built-in), default template features, or unsupported features (logging, telemetry, analytics).
