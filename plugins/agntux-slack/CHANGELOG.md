# Changelog

All notable changes to agntux-slack are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.2.2] — 2026-05-06

The actual Cowork iframe-render fix matching agntux-core 6.2.3 and
agntux-gmail 1.0.2. Prior 5.2.1 attempt was wrong-track.

### Fixed

- **MCP server now advertises the `io.modelcontextprotocol/ui` extension
  capability at initialize time.** Per SEP-1865 §"Client\<\>Server Capability
  Negotiation", MCP Apps is an opt-in extension that MUST be bidirectionally
  negotiated during `initialize`. Without the server-side advertisement,
  Claude Cowork silently disabled MCP Apps for this server's tools and fell
  back to text-rendering the `structuredContent`. MCPJam was lenient about
  this; Cowork follows the spec strictly. The server now declares
  `extensions: { "io.modelcontextprotocol/ui": {} }` alongside the existing
  `resources` and `tools` capabilities, so the compose and canvas iframes
  render in Cowork as well as in MCPJam.

## [5.2.1] — 2026-05-06

Render-fix patch matching agntux-core 6.2.2 and agntux-gmail 1.0.1: the
reply composer and canvas summariser now open their iframes in Claude
Cowork desktop, not just MCPJam.

### Fixed

- **`agntux_slack_compose_view` and `agntux_slack_canvas_view` descriptors
  now declare `outputSchema`.** Without it, Cowork text-renders the
  structuredContent JSON in chat instead of routing it to the iframe.
  Mirrors the official `scenario-modeler-server` example in
  `modelcontextprotocol/ext-apps` and the app project's `c023186` fix.
  Each schema lists every top-level success-shape key plus `error`, with
  no `required` fields so the structured-error envelope also validates.
- **Descriptor `_meta` now emits both `ui.resourceUri` (modern, nested)
  and `"ui/resourceUri"` (legacy, flat) keys.** Defensive against hosts
  that only read one of the two synonymous keys, matching what
  `registerAppTool` from `@modelcontextprotocol/ext-apps` does.
- **Removed bogus `visibility: ["model","app"]` from result `_meta.ui`.**
  Per spec, `visibility` belongs on the descriptor; the default — both
  surfaces can call — needs no annotation.

### Tests

- New regression guards on both `composeViewTool` and `canvasViewTool`
  descriptors assert the dual `_meta` keys and the presence of
  `outputSchema` with the expected top-level properties and no
  `required` fields.

## [5.2.0] — 2026-05-06

Symmetric cross-source action-merge with `agntux-gmail`. Ships alongside
the new agntux-gmail 1.0.0 plugin (one PR, two plugins, per
P7 §11.3 for tightly-coupled cross-plugin changes).

### Added

- **Step 9 — Cross-source merge protocol.** When a candidate slack action
  is `reason_class: response-needed` AND there is an open action authored
  by another plugin (e.g. `source: gmail`) created within the last 48
  hours AND an LLM-judged topic overlap matches, the slack run edits the
  existing sibling action instead of creating a duplicate: appends
  `Draft a Slack reply` + `Open in Slack` rows to `suggested_actions`,
  appends a `## Cross-source links` body section, and appends a
  `## Compose payload (slack)` body section so the slack compose view
  tool can lift its own payload from the same action file. Person
  overlap alone is NOT a sufficient match — the same person commonly
  spans many unrelated topics; the merge requires same-conversation /
  same-topic / same-decision judgment.
- **Step 8.5 — Cross-source-aware auto-resolution.** Path B added:
  scans open actions whose `## Cross-source links` body section
  references a slack thread that was just fetched, and runs the Step 8a
  reply-state scan against that thread. If the user has replied via
  Slack to a conversation that was originally raised by another plugin,
  the whole action auto-resolves with `## Auto-resolved`. Replying in
  any linked channel resolves the cross-channel item.
- `mcp-server/src/parse-action.ts`: `parseActionFile` now looks up the
  namespaced header `## Compose payload (slack)` BEFORE the bare
  `## Compose payload`, so a cross-source-merged action that carries
  both `(slack)` and `(gmail)` blocks routes the slack-namespaced one
  to slack's compose view tool.

### Notes

- The merge is opportunistic; agntux-slack works fine standalone. The
  reciprocal logic only fires if both plugins are installed and an
  overlapping topic conversation is in flight.
- No breaking changes to the action file shape. Existing actions that
  carry only `## Compose payload` (slack-only authored) continue to
  resolve via the bare-header fallback.

## [5.1.3] — 2026-05-06

Build-only fix for hosts that launch `mcp-server/dist/index.js` without
running `npm install` first (Claude Cowork desktop, and any other host
that follows the marketplace "no install step" contract documented in
the AUX-plugins repo's `CLAUDE.md`).

### Fixed

- **`mcp-server/dist/index.js` is now a self-contained esbuild bundle.**
  Previously the build was `tsc && embed-bundle.mjs`, which only
  transpiled TypeScript and left bare `import "@agntux/mcp-license"`,
  `import "@modelcontextprotocol/sdk"`, `import "@agntux/orchestrator-mcp-server/agntux-root"`,
  and `import "yaml"` statements in the dist. When a host extracted
  the plugin without installing workspace packages or `node_modules/`
  (the marketplace path), Node failed at the first import with
  `ERR_MODULE_NOT_FOUND` and the MCP server crashed silently — skills
  still surfaced (slash commands worked) but `agntux_slack_compose_view`
  and `agntux_slack_canvas_view` tools were invisible to chats. The
  build now runs `tsc --noEmit` for type-check, then `esbuild --bundle`
  to produce a single self-contained ~1.5 MB bundle that inlines
  `@agntux/mcp-license`, `@modelcontextprotocol/sdk`, `yaml`, and the
  cross-plugin `@agntux/orchestrator-mcp-server/agntux-root` import.
  Verified by running the bundle from a scratch directory with no
  `node_modules/` and no co-located `packages/` — exit 0 on stdin
  close.
- **`scripts/check-bundle-sync.mjs` is now scoped to its own plugin.**
  Same fix as agntux-core 6.2.1 — each plugin's copy of the script
  validates only its own dist, preventing a false positive when
  `build-plugin.mjs` rebuilds plugins serially after `rm -rf dist`.

### Internal

- Bumped esbuild ^0.24.0 into `mcp-server/devDependencies`. No new
  runtime dependency.

## [5.1.2] — 2026-05-06

True root-cause fix for the **Schedule a reply** bug originally attributed
to LLM tool-routing in 5.1.1. After 5.1.1 shipped, telemetry confirmed the
host was passing the correct args (`{action_id, initial_verb: "schedule"}`)
and the view tool was returning the correct `structuredContent`
(populated `drafted_body`, `initial_verb: "schedule"`) — but the iframe
still rendered an empty textarea with the **Send now** tab active. The
defect is in the iframe component, not the LLM:

`App.tsx` synthesizes a partial-shaped `toolOutput` envelope
(`{ _meta: { payload: partialInput } }`) while the host streams
`tool-input-partial` notifications, so `MainComponent` can render
progressive partials. But the streaming-skeleton check was
`!toolOutput && isStreaming` — and because `toolOutput` is *truthy*
during streaming (it's the synthesized envelope), the check never
fires. `ComposeCard` mounts during streaming with the partial-derived
payload (empty `drafted_body`, `initial_verb` defaulted to `"draft"`),
and `useState(drafted_body)` / `useState(initial_verb)` latch those
values for the lifetime of the mount. When the real tool result
arrives, the props update but the `useState`-backed `editedBody` and
`mode` ignore them, leaving the textarea empty and the Send-now tab
active. Channel/thread fields render correctly because they're read
straight from props each render.

### Fixed

- **`MainComponent` streaming-skeleton check reordered**: `if
  (isStreaming) return <streaming-skeleton />` is now the first branch
  in both `plugins/agntux-slack/ui-handlers/compose/component/src/components/main-component.tsx`
  and `…/canvas/component/src/components/main-component.tsx`. Loading-
  skeleton is now `if (!toolOutput) return <loading-skeleton />`. The
  card components (`ComposeCard`, `CanvasCard`) only mount once the
  real tool result has arrived, so their `useState` initializers latch
  the populated values. Same defect / same fix in canvas to prevent
  Summarise-to-canvas regressing identically.

## [5.1.1] — 2026-05-06

Originally framed as a fix for the same Schedule-a-reply bug now fixed
in 5.1.2. Post-mortem: the real defect was in the iframe component
(`MainComponent` streaming-skeleton check) — see 5.1.2. The 5.1.1
changes ship anyway as defensive descriptor hygiene: the rewritten
tool descriptions are clearer, prevent a separate class of
inline-args-overriding-on-disk regressions, and the new descriptor-
contract tests pin the trigger-phrase mappings against future
copy-edits.

### Fixed

- **`compose_view` tool description rewritten** to map trigger phrases to
  args verbatim — `'open the reply composer for action {id}'` →
  `{action_id}`, `'open the reply composer in schedule mode for action {id}'`
  → `{action_id, initial_verb: "schedule"}` — and to label the inline-args
  surface (`drafted_body`, `thread_context`, `channel`,
  `personalization_signals`, `proposed_send_time`, `slack_permalink`) as
  **LEGACY back-compat only**, with explicit "Do NOT pass for click-time
  trigger phrases" guidance on each parameter description. The `initial_verb`
  parameter description now spells out the prompt-phrase → enum-value
  mapping. Behavior of the handler is unchanged; only the tool description
  visible to the host LLM is updated.
- **`canvas_view` tool description rewritten** with the same shape
  (`'open the canvas summariser for action {id}'` → `{action_id}` only;
  inline `drafted_canvas`, `channel`, `thread`, and
  `proposed_followup_message` labelled LEGACY back-compat only) so the
  Summarise-to-canvas click path doesn't regress in the same way.
- **Descriptor-contract regression tests** added at the end of
  `mcp-server/__tests__/{compose-view,canvas-view}.test.ts`. Six new tests
  assert the trigger-phrase → arg mapping in `composeViewTool.description`
  / `canvasViewTool.description`, the `'in schedule mode' → 'schedule'`
  spell-out in the `initial_verb` parameter description, and the "LEGACY
  back-compat only … Do NOT pass for click-time trigger phrases" guard
  on every legacy inline-arg parameter. These pin the load-bearing copy
  so a future descriptor edit can't silently regress the bug fix.

No `ux:` prompt surface, no schema, no public-facing copy changed — patch
bump per §5.1.

## [5.1.0] — 2026-05-06

Internal refactor + dead-code cleanup. No user-visible behaviour change.

### Changed

- **Shared UI primitives moved to `@agntux/ui-primitives`.** The compose and
  canvas handlers now import `ScrollablePanel`, `AgntuxLogo`, `Spinner`,
  `ComponentErrorBoundary`, `LicenseErrorScreen`, `detectErrorEnvelope`,
  and the `safe-accessors` helpers from a new private workspace package
  at `packages/agntux-ui-primitives/`. Each handler used to ship its own
  byte-identical copy of these files; centralising them prevents the drift
  that accumulated across handlers.
- **Tailwind content config updated** in both compose and canvas handlers
  to scan `../../../../../packages/agntux-ui-primitives/src/**/*.{js,ts,jsx,tsx}`
  so the package's utility classes are picked up at build time.
- **Updated AGENTS.md authoring guidance** in both handlers to make
  `<ScrollablePanel>` (from the shared package) the canonical top-level
  layout primitive and to label modals as forbidden in inline-iframe
  surfaces. The reference file `references/ref-scrollable-panel.tsx`
  replaces the prior `ref-inline-scroll-patterns.tsx`.

### Removed

- `ui-handlers/{compose,canvas}/component/src/components/scrollable-modal.tsx`
  and the matching
  `__tests__/components/scrollable-modal.test.tsx` files. ScrollableModal
  was already retired in 5.0.0; this release deletes the dead-code files
  the bundle never referenced.
- Per-handler copies of `agntux-logo.tsx`, `spinner.tsx`,
  `error-boundary.tsx`, `scrollable-panel.tsx`,
  `lib/detect-error-envelope.ts`, `lib/safe-accessors.ts`, and the
  matching `__tests__/lib/detect-error-envelope.test.ts`. All consolidated
  into `@agntux/ui-primitives`.
- `references/ref-inline-scroll-patterns.tsx` (replaced by
  `references/ref-scrollable-panel.tsx`).

## [5.0.0] — 2026-05-06

User-reported bug: clicking Send / Schedule / Save-as-Draft / Create-canvas
in the Slack iframes asked the host to "use the agntux-slack plugin to
commit the drafted reply…" — the host has no Slack write tools on
agntux-slack (those live on the user's Slack Connector), and the envelope
carried no channel_id / thread_ts so any indirect router would have had to
re-read the action file from disk to recover the context. The chain was
fragile and frequently failed to reach a Slack write call.

### Changed (BREAKING)

- **Committed envelopes now target the user's Slack Connector directly.**
  All four iframe-emitted envelopes (`compose` Send / Schedule / Save Draft
  and `canvas` Create) carry the channel_id, thread_ts, body, mode, and
  send_at inline and instruct the host with `Use the Slack Connector to
  …`. Threading is explicit: the envelope tells the host to reply in the
  parent's thread and that the reply will start a thread on the parent if
  one does not yet exist. The retired shape was
  `ux: Use the agntux-slack plugin to commit the drafted reply for action
  {id} with body «…» (mode: …)` (envelope carried no Slack arguments).
  Per §5.1, any change to the `ux:` prompt surface is MAJOR.
- **`skills/draft/` is removed.** The skill's only job (parse the
  committed envelope → re-read the action file → invoke the Slack
  Connector) is obsolete now that the envelope carries every Slack
  Connector argument inline. Keeping it would create a competing parser
  for the new envelope shape. The `__tests__/draft-flow.test.ts` and
  `__tests__/envelope-shape.test.ts` files are removed for the same
  reason — both targeted the now-deleted skill's regex contract. Envelope
  shape is now covered by per-component unit tests under
  `ui-handlers/{compose,canvas}/component/src/__tests__/lib/`.
- **Discard is now a pure local action.** Clicking Discard in either
  iframe sets a local `discarded` flag, replaces the form with a
  "Discarded — no message was sent. The action item is still open."
  banner, and emits **nothing** to chat. The retired no-op envelope
  (`ux: Use the agntux-slack plugin to discard the draft for action {id}.`)
  is no longer sent.
- **Canvas commit is now a two-step host instruction.** The envelope
  instructs the host to (1) call `slack_create_canvas` with the assembled
  canvas content, then (2) call `slack_send_message` with the canvas URL
  formatted as Slack mrkdwn `<URL|title>` posted as a thread reply.
  Slack's auto-unfurl renders the link as a canvas-preview card. The
  iframe cannot precompute the URL — only the host has it after step 1.
- **`follow_up_intents` keys renamed** in `agents/ui-handlers/{compose,
  canvas}.md` to reflect the new routing target: `agntux-slack-commit-*`
  → `slack-connector-*`; `agntux-slack-{compose,canvas}-discard` →
  `{compose,canvas}-discard-local`. Operational manifests only — no
  runtime impact.

### Removed

- `skills/draft/SKILL.md` (and its `references/`).
- `__tests__/draft-flow.test.ts` and `__tests__/envelope-shape.test.ts`.

## [4.0.0] — 2026-05-06

Coordinated release with `agntux-core` 6.0.0 — both ship together.

### Changed (BREAKING)

- **All MCP tool names are prefixed with `agntux_slack_`**:
  `compose_view` → `agntux_slack_compose_view`, `canvas_view` →
  `agntux_slack_canvas_view`. Tool descriptions, agent ui-handler
  manifests (`view_tool:` field), the draft skill's tool surface
  list, and the relevant tests are updated. Per the §5.1 rubric,
  public-surface tool renames are MAJOR.
- **`Mark done — already handled in Slack` is no longer authored** by
  `skills/sync/SKILL.md`. The standard suggested-actions block now
  emits three rows (`Draft a reply`, `Schedule a reply`, `Open in
  Slack`) plus an optional `Summarise to canvas`. The retired row
  was redundant with agntux-core's built-in triage Done button; the
  `completed-externally` outcome marker the row was uniquely tagged
  with is now reachable via the triage Dismiss modal's "Completed
  externally" outcome option. User-visible button removal is MAJOR
  per the rubric. Existing on-disk action files written by 3.x.x
  ingest runs continue to render the old row as long as they live
  in `actions/`; the click still routes correctly to
  `mcp__agntux-core__agntux_core_set_status` (also renamed in 6.0.0).
- **Cross-plugin reference updates.** The draft skill's Step 8 now
  calls `mcp__agntux-core__agntux_core_set_status` (not
  `mcp__agntux-core__set_status`). Same for the README's
  suggested-action flow description, the agent ui-handler doc
  references, and the `__tests__/draft-flow.test.ts` assertions.

### Added

- **AgntUX logo + named header on the compose and canvas iframes.**
  Header now reads `[AgntUX wordmark] · Slack Compose · #{channel}`
  (and analogous for canvas: `· Slack Canvas · #{channel}`).
  Wordmark is an inline SVG that adapts to theme (`currentColor` for
  "Agnt", fixed teal→blue→purple gradient for "UX") to match
  `app/public/logo.svg`. Each component owns its own copy to keep
  per-handler bundles self-contained.
- **Success banner above the compose / canvas footer** after a
  successful commit. Compose: mode-aware copy ("Success — reply
  sent to #{channel}." / "Success — reply scheduled for {time} in
  #{channel}." / "Success — saved as a Slack draft in #{channel}.").
  Canvas: "Success — canvas created and link posted to #{channel}."
  Banner uses `role="status"` + `aria-live="polite"`. The existing
  primary-button morph (idle → sending → sent!) is unchanged; the
  banner is a clearer secondary acknowledgement so the user can't
  miss the success state.

### Fixed

- **Scheduled-run permission re-prompts.** Both `skills/sync/SKILL.md`
  and `skills/draft/SKILL.md` now mirror agntux-core 6.0.0's
  canonical path-resolution rule: `~/agntux/` must be expanded to
  its absolute home form on resolution and used as that exact string
  for every subsequent file op. The host's "Allow for scheduled
  runs" allowlist keys on the literal path string, so consistent
  canonicalisation lets one allow click hold across runs. See the
  agntux-core 6.0.0 changelog for the full rationale and the
  optional host-level allowlist block.

## [3.0.0] — 2026-05-05

### Changed (BREAKING)
- **`ux:` prompt text changed for three suggested-action buttons.** `Draft a reply` now emits `ux: Use the agntux-slack plugin to open the reply composer for action {id}.`; `Schedule a reply` emits `...open the reply composer in schedule mode for action {id}.`; `Summarise to canvas` emits `...open the canvas summariser for action {id}.`. The new prompts match the `compose_view` / `canvas_view` tool descriptions directly so the host routes the click straight to the iframe with no `draft` skill round-trip. The prior chat-routed path (LLM → draft skill → fetch thread → compose body → call view tool) was unreliable: hosts often couldn't find the skill ("I don't have access to a draft skill that would handle composing Slack replies"). The new path is single-hop. Per the §5.1 version-bump rubric any change to a `ux:` prompt is MAJOR.
- **Two suggested-action buttons removed.** `Snooze 24h` and `Stop raising items like this` are no longer authored by the sync skill. Both were redundant duplicates of agntux-core's built-in triage chrome (the Snooze button + 24h preset, and the Details-modal "Stop raising" button at `main-component.tsx:653`). User-visible button removals are MAJOR per the rubric. Existing actions persisted on disk before this version continue to render their old buttons until they're re-raised; new actions emit four standard rows (Draft, Schedule, Open in Slack, Mark done) plus an optional Summarise to canvas.

### Added
- **`## Compose payload` body section** on every `response-needed` action item. Carries a fenced ```yaml block with `drafted_body`, `personalization_signals`, `thread_context` (parent + last reply + messages_preview), `channel`, `slack_permalink`, `generated_at`. The compose iframe loads this section at click time via `compose_view {action_id, initial_verb}` — no chat round-trip, no thread re-fetch, no body re-composition. The draft is informed by file-store context the sync skill gathers in the new Step 10.1 (`user.md`, `data/instructions/agntux-slack.md`, related-entity files, the 3 most recent overlapping action items within 14 days). Body section sidesteps the top-level YAML frontmatter parser's `---` collision risk.
- **`## Canvas payload` body section** for thread-summary-worthy items (those that ship `Summarise to canvas`). Same fenced YAML idiom; mirrors `canvas_view`'s input schema. Same Step 10.1 context-gathering applies.
- **`compose_view` and `canvas_view` are now dual-mode.** Both view tools accept `{action_id}` (and optional `initial_verb` for compose) alone and lift the structured content from the corresponding body payload section. Inline args still win when supplied (preserves the legacy commit-side flow from the draft skill). Tool descriptions front-load the new trigger phrases so the host's tool-descriptor matching routes click-time prompts here directly.
- **`compose_payload_missing` and `canvas_payload_missing` error envelopes** for legacy action files (pre-1.1.0) that lack the new body section. The compose / canvas iframe renders a graceful "Open it in Slack to reply there" message via new ERROR_COPY entries (`error-compose-payload-missing`, `error-canvas-payload-missing`).
- **`parseBodySection(body, header)` helper** in `mcp-server/src/parse-action.ts` lifts a fenced ```yaml block out of a `## ` body section. Mirrors agntux-core's `extractSection` idiom.
- New types `ComposePayload`, `CanvasPayload` exported from `parse-action.ts`. `parseActionFile` now returns `compose_payload` and `canvas_payload` alongside the existing fields.

### Changed
- **`skills/sync/SKILL.md` Step 10 inline `schema_version` bumped 1.0.0 → 1.1.0.** The bump is additive (new optional body sections; no required-field changes); old items without the new payload sections still render correctly via the new `*_payload_missing` error envelopes. **Body sections do NOT require a `data-architect` round-trip via `data/schema-requests.md`** — the validator hook gates on required frontmatter fields, not body sections.
- **`skills/sync/SKILL.md` Step 10.1 — Gather file-store context** added as a named sub-step inside Step 10 (preserves the canonical 12-step ordering contract). Re-consults `user.md`, `data/instructions/agntux-slack.md`, related-entity files, and the 3 most recent overlapping recent action items within 14 days before composing the `## Compose payload` / `## Canvas payload` sections. Drafts reflect what the user already knows / is doing, in the user's voice.
- **`skills/sync/SKILL.md` `suggested_actions` rules** updated: 2–5 buttons (was 2–7); "Snooze 24h is always last" copy retired (button removed); the self-contradicting *"Don't pre-fill orchestrator-authored content"* sentence is replaced with a paragraph documenting the §4 contract divergence (composition at ingest, not at click — intentional per user direction; freshness window bounded by sync cadence; iframe Send button is still the explicit authorisation gate for the actual Slack write).
- **`skills/draft/SKILL.md` simplified.** Steps 1–6 collapse to: parse the inbound verb, read `source_ref` from the action file (still required at Step 7 to call `slack_send_message`), call `compose_view {action_id, initial_verb}` (or `canvas_view {action_id}`), wait for the committed envelope. The previous Step 3 thread-fetch and Step 4–5 working-memory body composition are gone (those happened at ingest in 1.1.0+). Both copies of the *"Do NOT pre-fill orchestrator-authored content during ingest"* line are removed; that invariant is intentionally inverted per user direction. Steps 6.5+ (envelope parsing + Slack write tool dispatch + `mcp__agntux-core__set_status`) are unchanged.
- **`skills/draft/SKILL.md` description updated** to reflect that the click-time path is now a legacy / pre-1.1.0 fallback. New action files route the click directly to `compose_view` / `canvas_view` via the new `ux: ...open the reply composer for action {id}` shape; this skill remains a commit handler for the iframe's emitted envelopes.

### Compatibility
- Requires **agntux-core ≥ 5.3.0** for the optimistic-hide triage UI behaviour and the `# Never raise` triage-button fast-path in the `user-feedback` agent. On older agntux-core, the iframe's mutate buttons still work but rows don't disappear until a manual re-render of `triage_view`, and the Stop-raising button surfaces a clarifying interview rather than capturing the rule directly.
- The legacy `ux: ...draft a reply for action {id}` shape continues to match `skills/draft/SKILL.md` so action items written by 2.x.x sync runs keep working during the transition window. Action files re-raised by 3.0.0+ ingest emit the new `open the reply composer` shape.

### Migration
- **No user data migration.** Existing action items are unchanged on disk. Legacy items missing `## Compose payload` render the new `compose_payload_missing` error inside the compose iframe (graceful fallback). New items written by the 3.0.0 sync skill carry the body section and render the editable draft directly.
- **The `Snooze 24h` and `Stop raising items like this` buttons** disappear from newly-raised actions. The functionality is unchanged: the agntux-core triage UI ships both as built-in chrome (Snooze button with 24h preset; Stop raising in the Details modal). Existing action items written before 3.0.0 keep their authored buttons until re-raise.

## [2.1.0] — 2026-05-05

### Added
- **`Open in Slack` suggested action now carries a real deep link.** Previously the row used `host_prompt: "ux: Use the agntux-core plugin to print the Slack permalink for action {id}."`, which routed to a non-existent printer skill and never produced a working link. The row now carries a constructed `url` field (consumed by the new `url`-aware suggested-action surface in agntux-core 5.2.0). Clicking dispatches through the host's `openLink()` primitive — the link opens directly in the browser or native Slack client without round-tripping through the LLM.
- **`workspace_subdomain` captured once per workspace and persisted in `data/learnings/agntux-slack/sync.md` frontmatter.** Parsed from any Slack MCP `Permalink:` field via the regex `^https?://([^.]+)\.slack\.com/`. The value is workspace-stable; once set it is never overwritten. Powers the URL templates the deep-link guide documents (`~/Downloads/slack-deeplink-guide.md`).
- **Optional `slack_user_id` and `slack_dm_channel_id` frontmatter on `person` entities.** When the source artefact carries the relevant identifiers, they are persisted as additive optional frontmatter (no contract change — these are not in `proposed_schema.entity_subtypes[person].required_frontmatter`, and the validator hook at `plugins/agntux-core/hooks/validate-schema.mjs` only gates on the required-set; unknown frontmatter keys pass through). Pre-positions the data a future entity-chip UI needs to render `Open user profile` / `Open DM` buttons without forcing a re-sync.

### Changed
- `skills/sync/SKILL.md` Step 2 — `sync.md` template now includes `workspace_subdomain: null` on first creation.
- `skills/sync/SKILL.md` Step 5b — discovery loop captures `workspace_subdomain` on first observed permalink.
- `skills/sync/SKILL.md` Step 6 — person-entity creation/update now also persists optional Slack identifiers when available.
- `skills/sync/SKILL.md` Step 10 — `Open in Slack` suggested-action row replaced with a `url:` form. URL is constructed from `workspace_subdomain` + `source_ref` for thread-rooted, top-level channel, and DM-rooted actions (single template covers all three). When `workspace_subdomain` is still `null` (cold-start, first run), the row is omitted entirely; the next run includes it once a permalink is observed.
- `skills/sync/SKILL.md` Step 11 — added a step to persist `workspace_subdomain` alongside cursor advancement.

### Compatibility
- Requires **agntux-core ≥ 5.2.0** for the `url`-field-aware triage UI. On older agntux-core, an action-item row carrying only `url` (no `host_prompt`) would be dropped by the parser — `Open in Slack` would simply not appear; other suggested actions are unaffected.

### Migration
- No user data migration. On the next scheduled sync, sync.md gains the new `workspace_subdomain` field automatically. Existing action items continue to render their old buttons until they are re-raised; new action items emit the corrected `Open in Slack` row.

## [2.0.0] — 2026-05-04

### Added
- **`mcp-server/`** — new TypeScript MCP server hosting two view tools (`compose_view`, `canvas_view`), HTTP_MODE for local MCPJam testing (port 5180), build-time bundle embed pipeline, `check:bundle-sync` CI guard. Mirrors `agntux-core/mcp-server/` shape; depends on `@agntux/orchestrator-mcp-server` (file: ../../agntux-core/mcp-server) for the shared `expectedAgntuxRoot` resolver.
- **`ui-handlers/compose/`** — `ui://slack-compose` MCP App. Inline iframe for the Draft / Schedule / Save-Slack-draft flow on every Slack action item. Renders thread context, the agent-drafted reply body in an editable textarea, mode tabs, "Why this draft" personalization-signals disclosure, and a Send button that emits a committed envelope back to the draft skill.
- **`ui-handlers/canvas/`** — `ui://slack-canvas` MCP App. Inline iframe for the Summarise-thread-to-canvas flow. Renders four editable section blocks (TL;DR, Decisions, Open questions, Participants) plus an editable title and a Preview tab. Decisions and Open questions are JSON-encoded in the committed envelope so single-pipe items round-trip correctly.
- **`agents/ui-handlers/{compose,canvas}.md`** — operational manifests for both UI handlers.
- **`marketplace/listing.yaml → ui_components:`** — declares both UIs to the marketplace.
- **+475 vitest cases** across the four test suites (zero pre-existing for these surfaces):
  - mcp-server: 27 (cap enforcement, structured-error branches per view tool)
  - compose component: 114 (parsePayload, render, mode-toggle, Send-emit, edit-preserves-state, all UI primitives)
  - canvas component: 107 (canvas-card render, list-editor, preview tab, JSON list-encoding round-trip)
  - top-level: 227 (draft-flow committed-envelope routing assertions, ui-routing static checks, envelope-shape regex contract)
  Total: 475 tests, all green; component bundles ≤260 KB gzip.

### Changed (BREAKING)
- **`skills/draft/SKILL.md` — Step 6 calls a view tool, no chat-text confirmation.** The prior chat-only "show payload, ask yes/no/edit" cycle is retired. Step 6 now calls `mcp__agntux-slack__compose_view` (or `canvas_view`) with the agent-drafted body; the host renders an iframe; the user edits/accepts inside the iframe. New Step 6.5 parses the committed envelope the iframe emits via `sendFollowUpMessage` and treats it as the explicit `yes` for that exact body. The skill MUST NOT re-compose between commit and send — user edits are authoritative.
- **Suggested-action click → iframe round-trip.** Every Slack action item's "Draft a reply" / "Schedule a reply" / "Summarise to canvas" button now renders an MCP App iframe (assuming a host that supports `text/html;profile=mcp-app` rendering — currently Claude Cowork). The chat-only path is no longer authored. If the host doesn't render the iframe, the user surfaces the issue conversationally.

### Migration
- No user data migration. Existing action items are unchanged. Suggested-action `host_prompt` templates are unchanged at the ingest-write surface — the click still emits the same `ux: Use the agntux-slack plugin to draft a reply for action {id}.` envelope; only what happens *after* the draft skill receives that envelope changed (iframe instead of chat).
- Hosts that don't support MCP App rendering will surface a tool-call result without UI. The user can edit and re-fire, but the iframe is now the primary editing surface; chat-only fallback is intentionally not authored to avoid confusing the host into giving up on the iframe path.
- Plugin authors who depend on `expectedAgntuxRoot` from `agntux-core`'s MCP server can now import it via `@agntux/orchestrator-mcp-server/agntux-root` (new subpath export shipped in agntux-core 5.1.0). The slack plugin uses this pattern.

## [1.1.1] — 2026-05-04

### Added
- **Step 5c-pre — Drain bootstrap-deferred null thread cursors (every run).** Before walking channel cursors, iterate every thread-shaped key (`<channel_id>#<thread_ts>`) whose value is `null` and call `slack_read_thread` to drain it, advancing the cursor to the newest reply ts processed. Bootstrap-deferred null thread cursors used to survive across runs if the per-channel pass crashed before Step 5d ran (Step 5d ran AFTER per-channel polling); 5c-pre runs FIRST every scheduled tick so a `null` thread cursor never persists past the next successful invocation.
- **`Thread: N replies` envelope-line trigger** in Step 5c heuristic 4. The Slack MCP `slack_read_channel` detailed format does not return a numeric `reply_count` — thread presence is signaled by a literal trailing line `Thread: N replies (latest: YYYY-MM-DD HH:MM:SS TZ)` in the message envelope. Without recognising that line, threads on messages without a `reply_count` field were silently skipped. Step 5e heuristic (a) (the orphan-thread coverage check) now also recognises the envelope line so it doesn't false-positive.

### Changed
- **Step 5d's bootstrap branch is now a defensive fallback only.** Step 5c-pre owns the steady-state path of draining null thread cursors. Step 5d's branch is retained so a partial 5c-pre run (host crash, hook timeout) doesn't cause data loss — but reaching it is unexpected, and the prompt now explicitly notes this so the agent doesn't silently skip null cursors.

### Migration
- No user action required. Existing thread cursors are unaffected; the change only governs how `null`-valued thread cursors are drained on subsequent runs (sooner, regardless of where they came from).

## [1.1.0] — 2026-05-04

### Added
- **Step 5e — Thread coverage check.** A self-check after fetching: every parent message processed in this run must either (a) lack any thread evidence, (b) be in the `fanned_out` set or have a non-null thread cursor, or (c) have been covered by Step 5d. Anything else logs `slack-thread-orphaned` to `sync.md → errors` so the gap is observable. No new MCP calls.
- **Step 8a — Reply-state scan.** Before raising a `response-needed` action, scan the in-memory fetch buffer for a user reply to the candidate trigger. If the user already replied and no follow-up question / mention / deadline / escalation appeared after that reply, skip the action and log `slack-user-already-replied`. If a follow-up did appear, raise the action and cite the follow-up in `## Why this matters`.
- **Step 8.5 — Reconcile open response-needed items.** After per-item triage and before dedup, walk `actions/_index.md` for `status: open`, `source: slack`, `reason_class: response-needed` items whose source thread/channel was touched this run. Apply the same Step 8a scan against the latest data; if the user has handled it in Slack, transition the action to `status: done`, set `completed_at`, and append an `## Auto-resolved` body section. Documented in "Honesty rules" as a new bounded automated authority.
- **Two new `suggested_actions` buttons** on every Slack action item:
  - `Mark done — already handled in Slack` routes to `agntux-core`'s `set_status` MCP tool with `outcome: "completed-externally"`. Captures the *positive* signal that an item was correctly raised — distinct from a bare dismissal.
  - `Stop raising items like this` engages `agntux-core`'s `user-feedback` subagent so the user can capture an explicit `# Never raise` rule. Captures the *negative* signal that this kind of item is genuinely noise.
- The Step 10 `## Why this matters` body now requires citing both the parent ts AND the most-recent / most-action-relevant reply ts when the source is a thread, so the action is reviewable without re-fetching.
- New `sync.md → errors` kinds: `slack-thread-orphaned`, `slack-bootstrap-interrupted`, `slack-user-already-replied`, `slack-reconcile-failed`.

### Changed
- **Step 5c thread fanout — pull every thread, always.** The previous rule gated thread fetching on `reply_count > 0`. Slack frequently omits `reply_count` on `slack_read_channel` payloads (especially in DMs and private channels), so threads were silently skipped. The new rule treats `reply_count > 0`, `reply_users_count > 0`, `latest_reply` set, `thread_ts` present, OR appearing as a `thread_ts` parent of any other fetched message ALL as evidence of thread activity — any one triggers a full `slack_read_thread` fetch. Failed thread fetches log `kind: source` and the dependent action item is suppressed for that run.
- **Step 6 / Step 8 triage prefix.** Before extracting entities or deciding action-worthiness on a thread-rooted message, the skill MUST construct an in-memory merged view (parent + replies, chronologically). Citing only the parent text when replies exist is a correctness bug — this rule makes the merged-thread requirement explicit. The Step 10 `## Why this matters` rule above is the readable side of the same requirement.
- **Step 4 onboarding mode — drop the 5-channel cap, add a heads-up message.** The bootstrap run now processes every channel surfaced by discovery (no per-channel cap; coverage > snappiness for a one-time post-setup run). Before per-channel polling begins, the skill prints a single user-facing chat message announcing the channel count and stop-to-redirect option. Cancellation mid-bootstrap leaves unprocessed channels with `null` cursors for the next scheduled run; that condition logs `slack-bootstrap-interrupted` (renamed from `slack-onboarding-deferred`).

### Migration
- No user action required. Step 8.5's auto-resolution only fires for thread/channel data fetched in the current run, so existing open actions are unaffected unless their source is touched. Existing dismiss / snooze flows are unchanged. The two new `suggested_actions` buttons appear on freshly-raised actions; existing action files are not rewritten.

## [1.0.0] — 2026-05-03

### Changed (BREAKING)
- **Sub-agents converted to top-level skills with `context: fork` +
  `agent: general-purpose`.** `agents/ingest.md` is now
  `skills/sync/SKILL.md`; `agents/draft.md` is now
  `skills/draft/SKILL.md`. The `agents/` directory is removed.
  This is the load-bearing fix: Cowork prefixes connector tools with a
  per-instance UUID, sub-agents must declare every tool in frontmatter
  `tools:`, and Cowork blocked the previous router-skill's attempt to
  edit the ingest sub-agent's `tools:` line at dispatch time — so the
  sub-agent ran without the namespaced Slack tools and silently failed.
  With `context: fork` + `agent: general-purpose` per the official
  Claude Code skill docs, the forked context inherits the host's full
  tool surface (including `mcp__<uuid>__slack_*`), no frontmatter edit
  is needed, and the dispatch path is direct (host description-match
  → skill, no router in between).
- **Router pattern retired.** The previous `skills/sync/SKILL.md`
  classified Lane A (ingest) vs Lane B (draft) and dispatched to the
  matching sub-agent. With auto-routing, each skill matches its own
  inbound prompts via its `description:` frontmatter directly — same
  mechanism that picks between `/agntux-onboard` and `/agntux-schema`.
  Lane B's UUID-resolution + frontmatter-edit dance is gone (lines
  50–88 and 104–134 of the old SKILL.md).

### Changed
- `recommended_ingest_cadence` flipped from `"Hourly"` to
  `"Every 30 min, 7am–10pm weekdays — chat is time-sensitive during
  work hours, quiet otherwise"`. The field is now treated as free-form
  authoring intent: personalization reads it verbatim and hands it to
  the host's scheduled-task tool (which accepts cadence strings or
  cron expressions). Old behaviour was 24/7 polling — wasteful
  overnight and weekend runs for a chat source that only matters
  during work hours. README and `marketplace/listing.yaml` copy
  refreshed accordingly.
- README's "Install" step rewritten to drop the fictional
  "host-dropped `.proposed` file" claim. The architect's Mode B reads
  this plugin's schema proposal directly from `marketplace/listing.yaml
  → proposed_schema` during `/agntux-onboard`.
- Step 0 contract-missing exit message changed from
  "awaiting data-architect Mode B run" to "run `/agntux-onboard`;
  will retry on the next scheduled tick" — `/agntux-onboard` is the
  user-facing entry point that triggers Mode B.

### Removed
- `agents/ingest.md` (moved to `skills/sync/SKILL.md`).
- `agents/draft.md` (moved to `skills/draft/SKILL.md`).
- `agents/` directory.
- The Lane B pre-dispatch UUID-resolution block in the previous
  `skills/sync/SKILL.md` router (no longer needed).

## [0.2.0] — 2026-05-03

### Changed
- **BREAKING:** Renamed plugin slug `slack-ingest` → `agntux-slack`. The
  new convention is that every AgntUX plugin slug starts with `agntux-`;
  the `-ingest` suffix is retired. The slash command is now
  `/agntux-slack:sync` (previously `/slack-ingest:sync`); subagent
  namespaces are `agntux-slack:ingest` and `agntux-slack:draft`. Internal
  data paths moved from `data/learnings/slack-ingest/` and
  `data/instructions/slack-ingest.md` to `data/learnings/agntux-slack/`
  and `data/instructions/agntux-slack.md`.

### Added
- `skills/sync/SKILL.md` resolves UUID-prefixed Slack connector tool
  names via ToolSearch at dispatch time and injects them into the
  ingest/draft subagents' frontmatter `tools:` line. Cowork registers
  connector tools under a per-instance UUID, so the previous static
  `tools:` list silently dropped every Slack call. Lane A filters
  out write tools (read-only ingest); Lane B keeps them (the
  chat-confirm-then-write draft flow needs them). Both lanes fail loud
  if the post-filter set is empty.

## [0.1.0] — 2026-05-02

### Added
- Initial release. First production source-specific ingest plugin.
- `agents/ingest.md` — read-only 12-step ingest subagent. Discovery sweep
  (user-authored, user-mentioned, DM activity) seeds a per-channel cursor
  map. Per-channel polling fetches new messages; threads are fanned out
  via `slack_read_thread`. A separate tracked-threads registry catches new
  replies on parents older than the channel cursor. Hourly cadence.
- `agents/draft.md` — on-demand drafting subagent triggered by suggested
  actions (`Draft a reply`, `Schedule a reply`, `Summarise to canvas`).
  Drafts text in chat, shows the exact payload, asks for explicit yes/no,
  and only on `yes` calls `slack_send_message`, `slack_schedule_message`,
  or `slack_create_canvas`. No write tool fires without confirmation.
- `skills/sync/SKILL.md` — `/agntux-slack:sync` routing skill. Also
  dispatches inbound suggested-action prompts to `agents/draft.md`.
- `proposed_schema` declaring `person`, `company`, `project`, `topic`
  entity subtypes and the canonical six action classes — `deadline`,
  `response-needed`, `knowledge-update`, `risk`, `opportunity`, `other` —
  for `data-architect` Mode B review. (`decision-needed` is folded into
  `response-needed` per the architect's lock-file invariants.)
- Thread association invariant: every action item, entity-source row,
  and Recent Activity bullet keys on the parent's
  `(channel_id, thread_ts)`, never on a reply's own `ts`. Lesson learned
  from the previous Slack-ingestion attempt.
- Unified cursor map under `sync.md → cursor` carrying both
  channel-shaped (`<channel_id>`) and thread-shaped
  (`<channel_id>#<thread_ts>`) keys in a single JSON object — no
  separate `threads:` field, no schema divergence from the canonical
  sync.md shape. Thread-shaped entries evict at 30 days; channel-shaped
  entries never evict.
- Onboarding-mode cap: when `last_success` is null and the cursor map
  has zero channel-shaped entries (first run ever), process at most 5
  channels and queue the rest with `null` cursors. Keeps
  `/agntux-onboard`'s synchronous wrap-up snappy.
- `agents/draft.md` Step 8 calls `mcp__agntux-core__set_status` after a
  successful Slack write rather than direct-editing the action's
  frontmatter. The MCP server is the canonical surface for action
  mutations.
- Hooks bundle copied byte-for-byte from `canonical/hooks/` with the two
  documented placeholder substitutions (`public-key.mjs`,
  `agntux-plugins.mjs`).
