# Changelog

All notable changes to agntux-core are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [6.0.0] — 2026-05-06

Coordinated triage UX overhaul. Pairs with `agntux-slack` 4.0.0 — both
ship together. Five user-visible improvements; one pure rename pass on
the MCP tool surface.

### Changed (BREAKING)

- **All MCP tool names are prefixed with `agntux_core_`** so they no
  longer collide with whatever other servers the host has loaded:
  `triage_view` → `agntux_core_triage_view`, `set_status` →
  `agntux_core_set_status`, `snooze` → `agntux_core_snooze`, `dismiss`
  → `agntux_core_dismiss`. The component's `useAppsClient().callTool()`
  calls and the agntux-slack draft skill's `mcp__agntux-core__set_status`
  reference are updated to match. Per the §5.1 rubric, any change to
  the public tool surface is MAJOR. Existing in-flight tool calls from
  pre-6.0.0 hosts will fail with `Unknown tool` once the new bundle
  loads — no fallback shim by design (a shim would mask the breakage
  and the renames are user-visible in tool-call traces anyway).

### Added

- **AgntUX logo + named header on the triage card.** Header now
  reads `[AgntUX wordmark] · Action Item Triage` (was just `Triage`).
  Wordmark is an inline SVG that adapts to theme (`currentColor` for
  the "Agnt" portion, fixed teal→blue→purple gradient for "UX") to
  match `app/public/logo.svg`.
- **Created / Updated dates on every action card.** A new
  `Created … · Updated …` line renders below the summary using the
  `created_at` frontmatter field plus the file's mtime. The
  `updated_at` half is collapsed when the two timestamps are within
  a day of each other so steady-state cards stay quiet.
- **Sort dropdown replaces the priority↔due toggle.** Three options:
  Priority (default), Due date, Most recently created. The "Most
  recently created" sort uses the new `created_at` field surfaced
  in the payload.
- **"Do something else…" button on every action card** plus a matching
  affordance in the Detail modal. Opens a small modal with a textarea;
  on submit dispatches `sendFollowUpMessage` with a `Please take the
  following action based on the action item below: {prompt}` envelope
  followed by the action's id, title, priority, reason class, source,
  related entities, summary, why-it-matters, and personalization-fit
  text — so the host can act on the prompt with full context without
  re-fetching the action file.
- **Success-feedback toasts.** `Marked done.` / `Snoozed until {date}.`
  / `Dismissed.` / `Sent to AgntUX.` toasts surface in the top-right
  for 3 s after each successful mutation. Renders with
  `role="status"` + `aria-live="polite"` so screen readers announce
  the result without interrupting. Errors keep the existing red-line
  row indicator.
- **`triage_view` payload now exposes `actions[].created_at` and
  `actions[].updated_at`.** `created_at` is read from the action
  frontmatter; `updated_at` is the file mtime (frontmatter doesn't
  carry an `updated_at` for actions, and mtime captures status flips,
  body appends, and suggested-action edits without coupling to a
  writer that remembers to bump a field).

### Fixed

- **Action-specific modals (Details, Snooze, Dismiss, Do something
  else) anchor to the card the user clicked** instead of jumping to
  the iframe center. `ScrollableModal` accepts a new optional
  `anchor` prop; when provided, the panel positions absolutely near
  the trigger card (clamped to viewport bounds), and falls back to
  the centered behavior when omitted. Closes the long-list yank
  problem reported on triage backlogs of 20+ items.
- **The Detail modal closes after a suggested-action click.**
  Previously the modal stayed open and the underlying card had
  already been optimistically hidden, leaving the user staring at a
  modal anchored to a stale view. Now any suggested-action button
  inside the Detail modal calls `onClose()` after dispatch (matches
  the existing Done-button behavior).
- **Scheduled-task permission re-prompts.** Updated
  `skills/_resolve-root.md` (and the slack mirrors) to require
  resolving `~/agntux/` to its absolute path **on resolution**. The
  host's "Allow for scheduled runs" allowlist keys on the literal
  path string a tool was called with — emitting `~/agntux/...` on
  one run and `/Users/<you>/agntux/...` on the next caused the host
  to re-prompt every run. Canonicalising the path on resolution
  makes one allow click hold across all subsequent scheduled runs.
  See "Permission-allowlist note" at the bottom of
  `skills/_resolve-root.md` for the host-level allowlist block users
  can paste into `settings.local.json` if prompts persist.

### Internal

- **Triage component splits new files** under
  `ui-handlers/triage/component/src/components/`:
  `agntux-logo.tsx` (the inline SVG wordmark) and `toast.tsx` (the
  transient success/error notification primitive).
- **`scrollable-modal.tsx` adds an `anchor?: HTMLElement | null` prop**
  and a viewport-clamped top-offset compute so the panel positions
  near the trigger element without overflowing the iframe.
- **`triage-view.ts` reads file mtime via `statSync` per action** to
  populate `updated_at`. The handler still skips malformed files; an
  mtime read failure now also degrades gracefully (returns `null`
  rather than crashing the render).

## [5.3.0] — 2026-05-05

### Added
- **Optimistic hide in the triage UI.** The triage iframe now hides resolved
  rows client-side immediately after Snooze / Dismiss / Mark-done /
  "Mark done — already handled" / "Stop raising items like this" — without
  re-invoking `triage_view`. The hide is tracked in a transient
  `optimisticallyHidden: Set<string>` (plain `useState`, NOT widgetState —
  it should not survive an iframe remount). The set reconciles per-id
  against fresh `toolOutput`: an id stays hidden as long as the server
  still lists it in `data.actions` (slow-write race guard) and drops out
  once the server has moved it to `data.handled_recent` or removed it
  entirely. Filter chips and priority counts honour the hide so the
  header stays honest. Closes the UX gap where a successful mutation left
  the row visible because the iframe never re-rendered against new state.
- **Regex match-guard on suggested-action `host_prompt` dispatch.** Before
  adding an id to `optimisticallyHidden`, the dispatch path matches the
  prompt against three terminating patterns (`set action {id} status to
  done`, `snooze action item {id}`, `dismiss action item {id}`). The new
  agntux-slack 3.0.0 `ux: ...open the reply composer for action {id}`
  prompts intentionally do NOT match — clicking "Draft a reply" opens an
  iframe, it does not change the action's triage status, so the row must
  stay visible.
- **Fire-and-forget Stage 0 in `agents/user-feedback.md` Mode A.** When the
  orchestrator dispatches the "Stop raising items like this" triage-button
  prompt (`...items like {id} (reason_class: {class}, source: {source})`),
  the agent now parses `id`, `reason_class`, and `source` from the
  parenthetical, appends a `# Never raise` rule of the inferred shape to
  `<root>/data/instructions/{plugin-slug}.md`, confirms with one short
  line ("Captured: stop raising {reason_class} from {source}."), and
  stops. Zero clarifying questions. The triage button passes a
  fully-formed-rule signal — there is nothing to interview about. Mode
  A's interactive path is preserved for non-triage imperatives (e.g.,
  the user typing "never flag email from notifications@*" in chat).

### Changed
- `ui-handlers/triage/component/src/components/main-component.tsx` —
  `runMutation`'s `onSuccess` callback now hides the row optimistically
  on every status mutation; `handleSuggested` regex-matches terminating
  host_prompts before hiding; `handleStopRaising` hides immediately;
  `data.actions` and `data.handled_recent` are filtered through the
  hidden set before render; `priorityCounts` derives from the filtered
  list.

### Migration
- No user data migration. The hide is purely client-side and resets on
  every iframe remount. Existing scheduled `triage_view` invocations are
  unchanged. Plugins that emit suggested-action `host_prompt` strings
  matching the three terminating patterns above will now drive optimistic
  hide on click — that is the intended behaviour for `set_status` /
  `snooze` / `dismiss`-shaped prompts and is harmless for any plugin
  whose prompts don't match.

## [5.2.0] — 2026-05-05

### Added
- **`url` field on suggested actions.** `SuggestedActionRow` (consumed by the
  `triage_view` MCP tool and rendered by the triage UI handler) now accepts an
  optional `url` alongside `host_prompt`. When `url` is present, clicking the
  button dispatches through the MCP App host's `openLink()` primitive — the
  link opens directly in the browser / native client without routing the
  request through the LLM. When only `host_prompt` is present, the legacy
  `sendFollowUpMessage(host_prompt)` path is preserved unchanged.

  The parser requires `label` and at least one of (`host_prompt`, `url`); rows
  with neither are dropped. This is the additive surface change that lets
  ingest plugins emit pre-resolved deep links — the first consumer is
  `agntux-slack`'s `Open in Slack` action.

### Changed
- `mcp-server` package version 1.1.0 → 1.2.0 (MINOR — additive surface).

### Migration
- No user action required. Existing action files with only `host_prompt`
  continue to work unchanged. Plugins that want to emit pre-resolved deep
  links add `url:` to the suggested-action YAML in their generated
  `actions/*.md` files.

## [5.1.0] — 2026-05-04

### Added
- **`@agntux/orchestrator-mcp-server/agntux-root` subpath export.** The
  `resolveAgntuxRoot` / `expectedAgntuxRoot` resolver pair is now part of
  this plugin's public MCP-server surface so sibling AgntUX plugins (the
  first consumer is `agntux-slack`'s new `mcp-server/` for the
  `ui://slack-compose` and `ui://slack-canvas` UI handlers) can import it
  via:

  ```ts
  import { expectedAgntuxRoot } from "@agntux/orchestrator-mcp-server/agntux-root";
  ```

  Previously the resolver was internal to `agntux-core`'s MCP server and
  every new plugin that needed local-filesystem access had to vendor-copy
  the file. Re-exporting keeps the resolver in one place — when the
  resolution algorithm changes (e.g., a new fallback heuristic), every
  consumer picks it up on the next install. The export is surfaced under
  `package.json → exports["./agntux-root"]` with both `types` and
  `import` conditions so NodeNext consumers get full type information
  without an extra `@types/` shim.
- `package.json → types` field added at the package root for editors that
  ignore the conditional `exports` typings.

### Changed
- `mcp-server` package version 1.0.0 → 1.1.0 (MINOR — additive surface,
  no breaking changes). The `.` export shape is unchanged for existing
  callers (now formally typed via the conditional-export object), so
  upgrading is a no-op for anything that only consumes the orchestrator's
  default entry point.

### Migration
- No user action required. Existing scripts that build the plugin
  (`(cd mcp-server && npm install && npm run build)`) continue to work
  unchanged; the new subpath export becomes available automatically once
  the build runs because tsc already emits `dist/agntux-root.{js,d.ts}`.
  Plugins that want to consume the resolver add a workspace-relative
  `file:` dep to their own `mcp-server/package.json`:

  ```json
  "dependencies": {
    "@agntux/orchestrator-mcp-server": "file:../../agntux-core/mcp-server"
  }
  ```

## [5.0.0] — 2026-05-04

### Removed
- **`entity-browser` UI handler.** The `ui://entity-browser` resource, its
  handler manifest at `agents/ui-handlers/entity-browser.md`, and the
  `pivot` MCP tool that routed clicks into it have all been deleted.
  Triage is now the single inline surface this plugin renders. Related-
  entity badges in the triage UI are non-interactive in 5.0.0 (a click-
  to-`/agntux-ask` follow-up ships in 5.1.0). Removes one
  `ui_components` entry from `marketplace/listing.yaml`.
- **`mcp-server/src/tools/pivot.ts`** and `mcp-server/src/s3-fetch.ts`
  with their tests. The pivot tool was the only consumer of
  entity-browser; `s3-fetch` is replaced by the new build-time embed
  pipeline below.

### Changed
- **UI bundle distribution: S3 → build-time base64 embed.** The signed-
  URL S3 fetch flow is retired. `mcp-server/scripts/embed-bundle.mjs`
  now base64-inlines `ui-handlers/{name}/component/out/index.html` into
  the compiled MCP server JS at build time; `resources/read` decodes
  inline. Zero S3 dependency, zero runtime filesystem reads, zero
  signed-URL expiry. CI guard at
  `mcp-server/scripts/check-bundle-sync.mjs` fails the build if the
  embed is stale relative to the component bundle on disk.
  - Render-token JWT verification still runs in the iframe (extracted to
    a dedicated `mcp-server/src/license.ts` so the licensing model and
    distribution model stay in independent files going forward). The
    `~/.agntux/.license` cache's `signed_ui_base_url` field is no longer
    consumed by the orchestrator; the license-check hook may continue
    to populate it for back-compat with older plugin versions.
  - **MIME type changed** from `text/html` to
    `text/html;profile=mcp-app` per the MCP App protocol.
- **`/agntux-triage` skill: rewritten to render the interactive UI.**
  Interactive invocations call `mcp__agntux-core__triage_view`; the
  host renders `ui://triage`. Scheduled-background fires (Daily 08:00)
  preserve the legacy text-digest path via the retrieval subagent. Two
  paths share the same authoritative source (`<root>/actions/_index.md`
  + per-action files); neither calls source MCPs directly.
- **`mcp-server/src/index.ts`: HTTP_MODE for local UI testing.**
  `HTTP_MODE=1 PORT=<n>` swaps the stdio transport for
  `StreamableHTTPServerTransport` (stateful, UUID session id). `tools/list`
  responses now surface the per-tool `_meta.ui.resourceUri` so MCPJam-
  family hosts that key UI rendering off the tool descriptor (rather
  than the tool result) render correctly. Stdio remains the default.
- **`triage_view` MCP tool added.** Reads the local AgntUX project root
  server-side and returns priority-sorted open actions + recently-handled
  list. Zero required input fields (`view_handled_days?`, `limit?`
  optional caps), so the LLM spends ~zero tokens on tool args. Hard
  budgets enforced server-side: ≤30 actions, ≤10 handled in last 7 days,
  ≤200/600-char excerpts per body section, capped `related_entities` and
  `suggested_actions`. This is a justified deviation from the canonical
  "view tools must be stateless / no fs reads" rule because the data
  source IS local files.

### Added
- **Triage UI handler** (`ui://triage`) — inline-budget MCP App
  rendering priority-sorted open action items with snooze / dismiss /
  done controls, suggested-action buttons that route to source plugins
  via `sendFollowUpMessage`, a recently-handled accordion, and degraded
  states for `actions_index_missing` and `license_paused`. Source-
  agnostic styling: unknown `reason_class` values fall back to a neutral
  palette; `source` is rendered as plain text only — no
  per-source icons or branching UX.
- **`AGNTUX_ROOT_OVERRIDE` env-var escape hatch on
  `expectedAgntuxRoot()`.** Enables vitest workers (which can't
  `process.chdir`) to inject fixture roots, and lets hosts pin the root
  externally. Production never sets it.
- **E2E test infrastructure**: `ui-handlers/triage/component/` Vite
  scaffold from the canonical `_template/`, `mcp-server/scripts/
  {embed-bundle,check-bundle-sync}.mjs`, four fixture JSON files at
  `ui-handlers/triage/fixtures/`, and `test:e2e` / `test:e2e:all` /
  `test:e2e:check` scripts that drive a locally running MCPJam Inspector
  via `plugin-toolkit-test`. See `ui-handlers/triage/TESTING.md`.
- **+50 vitest cases**: 21 server-side `triage-view` tests, 26 component
  triage tests (parsePayload, render branches, mutations, suggested-
  action routing, filters, source-agnostic styling, viewport budget),
  and 3 structural tests confirming the entity-browser handler is gone.
  Total tests across the plugin: 375 passing, plus four green e2e
  fixture renders against MCPJam Inspector.

### Migration

This release contains breaking changes — MAJOR bump.

1. **Plugin authors who depended on `pivot` or `ui://entity-browser`**:
   route entity navigation through `/agntux-ask Tell me about
   {subtype}/{slug}` instead. The retrieval lane handles entity lookups
   without a dedicated UI surface in 5.0.0.
2. **Hosts running pre-5.0.0 caches**: the `~/.agntux/.license` cache's
   `signed_ui_base_url` field becomes orphaned (unused by the
   orchestrator). No action required; the license-check hook may
   continue to populate it for older plugins.
3. **CI/CD pipelines that build the MCP server**: the build now requires
   the component bundle at `ui-handlers/triage/component/out/index.html`
   to exist before `tsc && embed-bundle.mjs` runs. Add a `(cd
   ui-handlers/triage/component && npm install && npm run build)` step
   before `(cd mcp-server && npm install && npm run build)`. The CI
   guard `npm run check:bundle-sync` (in `mcp-server/`) fails the build
   if drift is detected.
4. **No user data migration required.** Action item files
   (`<root>/actions/*.md`), entity files, and personalization remain
   unchanged. The `agntux-triage` slash command still fires; it just
   renders an interactive UI now (interactive invocation) or a text
   digest (scheduled-background fire) per the same data source.

## [4.3.1] — 2026-05-04

### Added
- **`hooks/validate-contract.mjs` — PreToolUse linter for per-plugin contract files** (`<agntux project root>/data/schema/contracts/*.md`). Catches the broken "`## reason_class additions` section listing sub-tags by action_class" framing at PR / authoring time, before a real sync run tries to write a rejected action item. Three rules: (1) reject any contract containing a `## reason_class additions` header — sub-tags like `dm`, `mention`, `escalation` are NOT valid `reason_class` values, they belong in `reason_detail`; (2) every value listed in a `## reason_class enum` block MUST be in `schema.lock.json → action_classes`; (3) the value-by-action_class shape (`For **\`<class>\`**:` followed by sub-tag bullets) is rejected under any header containing the substring `reason_class`, even if the header is renamed.
- `__tests__/validate-contract.test.mjs` — 8 unit tests covering the rules above plus pass-through cases (out-of-scope path, fenced code-block examples, pre-bootstrap).

### Changed
- `agents/data-architect.md` — added a universal `## reason_class discipline` section with explicit rules + a worked negative example (the broken framing) and a positive example (the correct framing). Mode A Stage 5 (`actions/_index.md` write) and Mode B Stage 5 (contract write) both reference it. Closes the upstream gap that let the broken framing land in the first place: the prompt previously left `## reason_class notes` underspecified, so the subagent invented its own sub-categorisation framing.
- `data/schema-template/actions/_index.md` — clarified the `## reason_class enum` description so the closed-enum invariant is explicit. Replaced the ambiguous "Plugins may propose additional `reason_class` values via `proposed_schema → action_classes`" sentence (which conflated two field names) with unambiguous wording, plus a worked example contract showing the correct `## Action_class usage` + `## reason_detail prefixes` shape.

### Migration
- No user action required. Existing contracts authored before 4.3.1 are NOT auto-rewritten; the new linter only fires on writes (Write/Edit) to contract files. If a tenant already has a contract with the broken framing, the next architect-driven edit to that file will be blocked with a fixit message pointing to the renamed `## reason_detail prefixes` convention. Pre-bootstrap (no `schema.lock.json` yet) passes through silently.

## [4.3.0] — 2026-05-04

### Added
- **`outcome` and `outcome_note` arguments on the `set_status` and `dismiss` MCP tools.** When provided on a `done` or `dismissed` transition, the server appends a body section:

  ```markdown
  ## Outcome
  {outcome label} — {RFC 3339 timestamp}
  {optional outcome_note}
  ```

  Suggested values: `completed-externally`, `noise`, `irrelevant`. Free-form strings are allowed. The schema is unchanged — no new frontmatter fields, no new validator-hook contract, no schema_version bump in `data/schema/contracts/`. The marker is body-only.
- New `appendOutcomeSection` helper exported from `mcp-server/src/tools/set-status.ts` and reused by `dismiss.ts` so both tools share one body-write path.

### Changed
- **`agents/pattern-feedback.md`: stop reading bare dismissals as `→ deprioritize` signals.** A dismissal often means "I handled this in Slack already" — that's a *positive* signal, not a noise signal. The new rules:
  - Dismissal carrying `## Outcome: completed-externally` (or any "already handled elsewhere" marker), OR `status: done` with an `## Auto-resolved` body section (written by `agntux-slack` Step 8.5) → counts as a **positive** signal (`→ trust this signal more`), the inverse of `→ deprioritize`.
  - Dismissal carrying `## Outcome: noise` or `## Outcome: irrelevant` → counts toward `→ deprioritize`.
  - Dismissal followed by an explicit `# Never raise` rule capture in `data/instructions/{plugin}.md` within ±24h → counts toward `→ deprioritize`.
  - **Bare dismissal (no outcome marker, no paired `# Never raise`)** → ambiguous; does NOT contribute to deprioritize patterns, does NOT contribute to trust-more patterns. Skipped.

  Pattern dimensions, the "Append to # Auto-learned" examples, and the graduation-candidate example all updated accordingly. The result: pattern-feedback only proposes `→ deprioritize` graduation candidates when there is *real* evidence the user thinks the items are noise, not just that they cleared their inbox.

### Migration
- Existing `set_status` and `dismiss` callers continue to work unchanged — the new arguments are optional. Action items written before 4.3.0 have no `## Outcome` body and are treated as ambiguous (bare) dismissals by pattern-feedback. Going forward, ingest plugins should wire their `Mark done — already handled` and "noise" affordances through the new `outcome` arg so the signal reaches pattern-feedback.

## [4.2.1] — 2026-05-03

### Changed
- **Architectural simplification: dropped the `.proposed` file dance.**
  The previously documented "host install hook drops a `.proposed`
  file" path was never implemented — and the `.proposed` filename was
  pure indirection over `marketplace/listing.yaml → proposed_schema`,
  which already carries the same machine-readable description. Mode B
  now reads each plugin's proposal directly from
  `${plugin-root}/marketplace/listing.yaml → proposed_schema`. The
  trigger flips from "found a `.proposed` file" to "an installed
  plugin lacks `data/schema/contracts/{slug}.md`". Plugin authors do
  not need to do anything; ingest plugins behave identically from the
  user's perspective once the architect catches up.
- `agents/data-architect.md`: dropped `Bash` from the tool surface
  (no `.proposed` file deletion, so `rm -f` is no longer required).
  Mode B Stage 1 reads from the plugin's `listing.yaml` via the
  `mcp__plugins__list_plugins` tool, with a conventional-layout
  fallback (`${CLAUDE_PLUGIN_ROOT}/../{slug}/marketplace/listing.yaml`)
  for hosts that don't expose it.
- `agents/personalization.md` Mode A connector detection, Mode A-bis
  set computation, schema-drift nudge, and deterministic wrap-up
  state scan all switched from "Glob `*.md.proposed`" to "walk
  `## Installed` and check `contracts/{slug}.md` existence".
- `skills/_preconditions.md` check #3 + `skills/_preflight.md`
  rewritten to enumerate installed-without-contract plugins instead
  of `.proposed` files. `skills/agntux-onboard/SKILL.md` and
  `skills/agntux-schema/SKILL.md` copy refreshed accordingly.
- `__tests__/authority.test.mjs`: data-architect tool surface
  expectation tightened to drop `Bash`.

## [4.2.0] — 2026-05-03

### Added
- `resolveAgntuxRoot()` shared resolver in `hooks/lib/agntux-root.mjs`
  + TS twin in `mcp-server/src/agntux-root.ts`. Hooks and MCP servers now
  agree on the AgntUX project root (any directory named `agntux`,
  case-insensitive, falling back to `~/agntux`). 8 unit tests pass.
- `personalization` Stage 0 rewritten as a 5-step discover/Glob/mkdir
  flow with a one-time `~/agntux-code/` → `~/agntux/` migration aid.
- `_preconditions.md § 0.5` plugin reconciliation via
  `mcp__plugins__list_plugins` — runs at the start of every `/agntux-*`
  command, auto-syncs `# AgntUX plugins → ## Installed`, and emits a
  one-line nudge for newly-installed plugins. Non-blocking.
- `personalization` Stage 5 wrap-up State A initial-sync consent gate
  (yes / no / one at a time) with a Cowork-thread parallelism tip; same
  gate runs in Mode A-bis for newly-onboarded plugins. Three wrap-up
  branches (all-yes, mixed-with-skipped, all-no) describe the resulting
  state explicitly.

### Changed
- **BREAKING:** Naming convention — every AgntUX plugin slug now starts
  with `agntux-`. `notes-ingest` is retired; `slack-ingest` is renamed
  to `agntux-slack`. `data/plugin-suggestions.json` lists `agntux-slack`
  (`available`) and `agntux-gmail` (`coming-soon`) — `notes-ingest`
  removed. The `hooks/lib/agntux-plugins.mjs` substituted slug list
  grows from `["agntux-core"]` to `["agntux-core", "agntux-slack"]`.
  The validator's `sourceTokenToSlug` accepts both the new `agntux-*`
  prefix and the legacy `*-ingest` suffix during the migration window.
- `agents/personalization.md` Stage 0 step 4: prefer the Cowork
  directory-request tool (`mcp__cowork__request_cowork_directory`) over
  a homedir `Glob` to avoid sandbox failures. Glob is now the last-resort
  branch in non-Cowork hosts.
- `agents/personalization.md` Stage 4.6 step 3: scheduled-task creation
  resolves explicitly via `ToolSearch` for
  `mcp__scheduled-tasks__create_scheduled_task` with idempotency check
  via `list_scheduled_tasks`. Copy/paste fallback retained for
  non-Cowork hosts.
- Off-peak default cadences: `Daily` ingest fallback shifts from
  `09:00` to `04:00`; daily action-item digest from `08:00` to `13:00`.
  Per-source walkthrough adds a peak-hours guard that shifts any
  daily/weekly cadence falling in 06:00–11:59 local time to the
  nearest off-peak slot. Hourly cadences are unaffected.
- Mode A-bis steps reordered so plugin reconciliation runs first
  (before set computation) — guarantees freshly-installed plugins are
  picked up.
- Hook libraries (`scope.mjs`, `schema-lock.mjs`) and ingest hooks
  (`maintain-index.mjs`, `validate-schema.mjs`) route path resolution
  through `resolveAgntuxRoot()` so they reach data the user has,
  regardless of which `agntux/` directory they cwd from.
- MCP tools (`dismiss`, `pivot`, `snooze`, `set-status`) use the new
  `expectedAgntuxRoot()` for path-traversal guards (string-only, no FS).
- ~140 prompt/doc/test references swept from literal `~/agntux/` to the
  `<agntux project root>/` placeholder for consistency with the resolver.

### Fixed
- Onboarding opener no longer narrates internal architecture
  ("subagent", "Mode A", "dispatch"). Replaced with a single AgntUX
  voice and a brief welcome.
- Project-root precondition no longer short-circuits before Stage 0.
  Stage 0 owns folder discovery, mkdir-prompt, and the picker
  instruction — and now leads with the explicit "AgntUX uses a folder
  named `agntux`" framing instead of the generic "select a folder"
  copy.
- Plugin suggestions are fenced to the AgntUX marketplace. Slugs are
  validated against `${CLAUDE_PLUGIN_ROOT}/../{slug}/marketplace/listing.yaml`;
  Anthropic / built-in / third-party plugins are never recommended.
  Discovery-surfaced needs without AgntUX coverage are stated honestly
  ("there isn't an AgntUX plugin for {source} yet — it's on the
  roadmap").
- Scheduled-task creation now uses the host's scheduled-task tool
  directly (Cowork supports this). Task bodies are bare slash commands
  with no preamble or source-pull instructions. Copy/paste fallback
  retained for hosts that don't expose the tool.
- Mode B cadence-change is now a direct edit through the host's
  scheduled-task tool, no longer a "you have to do it yourself" deflect.
- `agents/retrieval.md` no longer claims scheduled tasks are
  host-UI-only — it routes management to personalization Mode B.
- Onboarding wrap-up State A fires one immediate `/agntux-sync` per
  installed plugin so the user's first triage call has data, then
  points the user at the AgntUX Triage UI and suggests clicking an
  action item to surface the source-specific plugin UI.
- `skills/agntux-triage/SKILL.md` carries a defensive note: triage
  reads only the ingested store at `<root>/actions/_index.md`; any
  prompt-body instruction to "pull from {source}" is ignored.

## [4.1.0] — 2026-05-02

### Added
- `data/schema-design-rubric.md` §1a — canonical banned-words list
  (`subtype`, `schema`, `frontmatter`, `action_class`, `contract`,
  `lock file`) plus plain-language replacement table. Single source
  of truth for the no-jargon rule; `data-architect.md` and
  `personalization.md` reference it instead of duplicating.
- `skills/_preflight.md` — shared schema-drift preflight (the one-line
  nudge for pending `.proposed` contracts and queued schema-requests).
  Six user-facing skills now reference it instead of inlining.
- Stage 0.5 explicit `discovery_summary` confirmation step.
  Personalization shows the LLM-composed summary back to the user
  ("Here's how I'm reading your situation: …") and waits for approval
  before saving. Resolves the user-authority gap on a paraphrased
  frontmatter field.
- Stage 5.5 (architect Mode A — schema bootstrap) wired explicitly
  into the `/agntux-onboard` first-run dispatch. Closes the gap where
  Mode B was being dispatched before any schema existed.
- Mode A-bis re-entry now scans a third disjunct: instructions files
  with `status: draft` (interrupted onboarding). Without this, an
  interrupted per-plugin interview left the plugin in limbo with no
  recovery short of `/agntux-teach`.
- `(needs-clarification)` handling in architect Mode A: when
  discovery is too sparse even after the fallback question, write a
  minimal generic baseline plus an invitation to refine via
  `/agntux-schema edit` later. No flow blocking.
- Malformed `marketplace/listing.yaml` handling in personalization's
  per-plugin onboarding (missing / YAML-garbage / partial-fields all
  handled with explicit fallbacks).
- `recommended_ingest_cadence` value space documented (5 valid
  shapes; malformed values fall back to `Daily 09:00` with a user
  note).
- `agents/ui-handlers/{triage,entity-browser}.md` gain real
  `operational:` manifests (verb_phrases, view_tool, resource_uri,
  structured_content_schema, follow_up_intents, degraded_states).
  Clears the W03 stub-handler warnings.

### Changed
- `data-architect` tool surface: `+ Bash` (needed for `rm -f` to
  delete `.proposed` files after Mode B; Edit alone can't unlink),
  `+ WebSearch` and `+ WebFetch` (synthesis aid during Mode A).
- `data-architect` Mode B Stage 5: explicit `rm -f` of the
  `.proposed` file plus a re-Glob verification step. Without
  deletion, the schema-drift nudge fires forever.
- `_preconditions.md` check #3 (pending `.proposed` contracts) now
  case-splits: missing or `status: draft` instructions →
  personalization Mode A-bis (per-plugin onboarding); `status: final`
  instructions → architect Mode B directly. Prevents bypassing the
  per-plugin interview.
- `_preconditions.md` documents that `/agntux-onboard` opts out of
  checks 2/3/4 (handles them inline via the new flow).
- `data-architect` Mode A Stage 4 / Mode C Stage 4: migration warning
  is unconditional on required-field adds — no `entities/` scan
  needed (architect doesn't have read authority there).
- `user-feedback` Mode B reframed as on-demand refresh only;
  install-time onboarding is owned by personalization Mode A's
  per-plugin interview.

### Fixed
- `mcp-server` is now installable and buildable (`@modelcontextprotocol/sdk`
  was missing from runtime deps); 4 pre-existing e2e smoke-test
  failures resolved.

## [4.0.0] — 2026-05-01

### Changed (BREAKING)
- Every named skill is renamed with the `agntux-` prefix to avoid
  slash-command collisions with other plugins on hosts that don't
  auto-namespace by plugin slug:
  - `/agntux-core:onboard` → `/agntux-onboard`
  - `/agntux-core:profile` → `/agntux-profile`
  - `/agntux-core:teach {plugin-slug}` → `/agntux-teach {plugin-slug}`
  - `/agntux-core:triage` → `/agntux-triage`
  - `/agntux-core:schema [review|edit] [plugin-slug]` → `/agntux-schema [review|edit] [plugin-slug]`
  - `/agntux-core:sync {plugin-slug}` → `/agntux-sync {plugin-slug}`
  - `/agntux-core:ask` → `/agntux-ask`
  - `/agntux-core:feedback-review` → `/agntux-feedback-review`
- Scheduled-task bodies must be migrated again — replace every
  `/agntux-core:*` reference in your existing scheduled tasks with
  the matching `/agntux-*` form.

### Added
- **Open-ended discovery interview.** `personalization` Mode A now
  opens with a single anchor question ("What do you want AgntUX to
  help you with?") and runs 3–6 adaptive follow-ups guided by
  `data/schema-design-rubric.md`. The first-run flow no longer
  assumes the user is a knowledge worker with an employer.
- `data/schema-design-rubric.md` — the architect's design playbook.
  Replaces the old role-preset library with shape-based guidance and
  illustrative patterns (knowledge-worker, marketing/community,
  healthcare, research, founder).
- **Schema synthesis in the user's vocabulary.** The data-architect
  presents what it'll keep track of in plain language ("your care
  team", "your campaigns", "people you work with") rather than
  technical subtype names. Internal canonical files are unchanged.
- **Connect-your-connectors gate.** After schema bootstrap, the
  personalization agent prompts the user to authorize connectors in
  Customize → Connectors, then enumerates what's connected and runs
  per-plugin onboarding for each.
- **Per-plugin onboarding interview** at install. ≤5 plain-language
  questions per plugin, captured to
  `~/agntux/data/instructions/{plugin-slug}.md` (status `draft` →
  `final` lifecycle).
- **Re-entrant `/agntux-onboard`.** Running it again after first-run
  detects new `.proposed` contracts (or instructions stubs missing)
  and walks the per-plugin onboarding only — no destructive rewrite
  unless the user explicitly says "redo from scratch".
- **Deterministic wrap-up.** State machine emits one of four
  end-of-onboarding messages with an actionable next step.
- **Stage 1.5 People.** Conditional capture of important people
  decided from discovery context. Subsection names are
  vocabulary-driven, not enum-fixed.
- **Schema-drift preflight.** Every entry-point skill emits a
  one-line nudge when there are pending `.proposed` contracts or
  queued schema-requests. Informational; doesn't block.
- **More signal channels into `data/schema-requests.md`.**
  Personalization Mode D, retrieval (failure-to-bind),
  pattern-feedback (graduation), and per-plugin onboarding interviews
  can now append schema-change requests in addition to user-feedback
  Mode C.
- **Timezone moved into Stage 1** (Identity) with system-clock
  auto-detect — it was previously bundled into Stage 5.

### Removed
- `data/role-presets/{default,pm,swe,sales}.md`. The architect no
  longer matches role-strings against a preset library; it
  synthesises a custom starter schema from discovery answers using
  the rubric. Illustrative content from the four presets has been
  folded into `data/schema-design-rubric.md` §4.

### Migration

| Old prompt body | New prompt body |
|---|---|
| `/agntux-core:onboard` | `/agntux-onboard` |
| `/agntux-core:profile` | `/agntux-profile` |
| `/agntux-core:teach {slug}` | `/agntux-teach {slug}` |
| `/agntux-core:triage` | `/agntux-triage` |
| `/agntux-core:schema review` | `/agntux-schema review` |
| `/agntux-core:schema edit` | `/agntux-schema edit` |
| `/agntux-core:sync {slug}` | `/agntux-sync {slug}` |
| `/agntux-core:ask` | `/agntux-ask` |
| `/agntux-core:feedback-review` | `/agntux-feedback-review` |

## [3.0.0] — 2026-04-30

### Changed (BREAKING)
- The flat `skills/orchestrator.md` (`/ux`) is **removed**. The Claude Code plugin spec requires skills under `skills/` to be directories shaped as `skills/{name}/SKILL.md`; flat files were silently dropped, so `/ux` never registered.
- The orchestrator's logic is now distributed across eight named skills under `skills/`:
  - `/agntux-onboard` — first-run interview + schema bootstrap chain
  - `/agntux-profile` — personalization edits (Modes B/C/D)
  - `/agntux-teach {plugin-slug}` — per-plugin instruction capture (user-feedback)
  - `/agntux-triage` — daily action-item digest (retrieval Pattern A)
  - `/agntux-schema [review|edit] [plugin-slug]` — data-architect Modes B/C
  - `/agntux-sync {plugin-slug}` — cross-plugin sync alias (re-dispatches to per-plugin sync)
  - `/agntux-ask` — catch-all classifier (retrieval Patterns B–E, inline status edits, click-time `ux:` slot drafting)
  - `/agntux-feedback-review` — daily pattern detection (background; `disable-model-invocation: true`)
- Scheduled-task bodies must be migrated:
  - `ux: triage today` → `/agntux-triage`
  - `ux: feedback review` → `/agntux-feedback-review`
- Description-driven auto-dispatch: each new skill front-loads its trigger phrases in
  `description:` so Claude's built-in skill auto-invocation routes natural-language prompts
  ("what's hot", "edit my profile") to the right skill without the user typing the slash
  command. `/agntux-ask` is the residual classifier for ambiguous prompts.

### Added
- `skills/_preconditions.md` — shared, non-invocable preconditions block referenced by every entry-point skill (project-root check, `user.md` exists, schema bootstrap state, `.proposed` contracts queue, schema-requests queue, trial-status banner).

### Migration

| Old prompt body | New prompt body |
|---|---|
| `/ux` | `/agntux-ask` (or speak naturally — auto-dispatches) |
| `/ux schema review` | `/agntux-schema review` |
| `/ux schema edit` | `/agntux-schema edit` |
| `/ux teach {slug}` | `/agntux-teach {slug}` |
| `ux: triage today` | `/agntux-triage` |
| `ux: feedback review` | `/agntux-feedback-review` |

The `ux:` prefix is **retained** for click-time drafting (`host_prompt` payloads with
`{propose_reply}`, `{summary}`, etc.) — that is a host-protocol detail, not a user
command, and it routes through `/agntux-ask`.

## [2.0.0] — 2026-04-29

### Added
- `agents/data-architect.md` — owns `~/agntux/data/schema/`. Modes A (bootstrap from `user.md`), B (plugin install review of `.proposed` contracts), C (schema edit). (P3a §1.1)
- `agents/user-feedback.md` — owns `~/agntux/data/instructions/`. Modes A (capture imperatives), B (teach interview), C (structural escalation to `data/schema-requests.md`). (P3a §1.2)
- `hooks/validate-schema.mjs` — PreToolUse blocking validator for entity/action writes against the tenant `schema.lock.json`. Helper at `hooks/lib/schema-lock.mjs`. (P3a §3)
- `data/schema-template/` — seed master contract + four default subtypes (person, company, project, topic) + actions index. (P3a §4)
- `data/role-presets/{pm,swe,sales,default}.md` — baseline schema proposals for the architect's Mode A. (P3a §4)
- Three new prompts in `marketplace/listing.yaml`: `/ux schema review`, `/ux schema edit`, `/ux teach`.
- Personalization Mode A interview adds Stage 2.5 (Day-to-Day, Aspirations, Goals with horizon tags) and Stage 4.5 (Sources). (P3a §2)

### Changed
- `agents/feedback.md` renamed to `agents/pattern-feedback.md`. Behaviour unchanged; rename disambiguates from the new `user-feedback` subagent. (P3a §1.3)
- `skills/orchestrator.md` adds Pre-classification stage (schema-bootstrap, `.proposed` review, schema-requests queue) and Lanes E (schema-review), F (schema-edit), G (teach).
- `agents/retrieval.md` gains read-only access to `data/schema/`, `data/instructions/`, `data/learnings/`. Per-plugin sync moves to `data/learnings/{plugin-slug}/sync.md`.

### Removed
- The `~/agntux/state/` directory. All persistent files now live under `~/agntux/data/`. Earlier P3a drafts proposed renaming `.state/` → `state/`; that intermediate step was retired per user direction.
- Source-plugin-generated learnings files (the per-plugin `*.state/notes/{source}/{source}.md`). The concept is gone from the data structure and the prompts. Anything an ingest plugin would have written there now goes either into `sync.md → errors` (transient signals; bounded last-10) or escalates to user-feedback Mode C.

### Schema
- Reverses P3 D6 ("plugins own contracts"). Vocabulary authority is now central (architect owns `~/agntux/data/schema/`); plugins read their permits from `data/schema/contracts/{plugin-slug}.md` at run-start. (P3.AMEND.4 / P4.AMEND.3 / P5.AMEND.1)
- Migration is **deferred** to P3b. The architect logs one-line warnings to `data/schema-warnings.md` for any change that would require a backfill.

### Path layout (final P3a)

```
~/agntux/
  user.md                                         personalization
  entities/                                       validated; ingest plugins write
  actions/                                        validated; ingest plugins write
  data/
    schema/                                       architect's surface
      schema.md, schema.lock.json
      entities/_index.md + {subtype}.md
      actions/_index.md
      contracts/{plugin-slug}.md (+ .proposed)
    instructions/{plugin-slug}.md                 user-feedback's surface
    learnings/{plugin-slug}/sync.md               ingest plugins' sync state
    schema-warnings.md                            architect-emitted log
    schema-requests.md                            user-feedback escalation queue
    onboarding.md                                 personalization Mode A progress (transient)
```

## [1.0.0] — 2026-04-01

### Added
- Initial release.
