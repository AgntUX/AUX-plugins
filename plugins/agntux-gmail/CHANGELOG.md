# Changelog

All notable changes to **agntux-gmail** are documented here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the version
in `.claude-plugin/plugin.json` MUST match the most-recent version section.

## [Unreleased]

## [4.3.3] — 2026-06-09

### Changed

- Shortened the marketplace description to a tighter, benefit-first summary
  (was a long five-sentence paragraph).

## [4.3.2] — 2026-06-09

### Changed

- Replaced a contributor's personal name and email with generic placeholders
  in the triage/deep-link skill examples.

## [4.3.1] — 2026-06-09

### Changed

- Plain-language pass on the listing copy — de-jargoned the reply-composer
  description and the "what it brings in" list.

## [4.3.0] — 2026-06-08

### Changed

- **The assistant now knows where your AgntUX data lives when you ask a
  question.** Added a shared "data access" guide so that when you query your
  email conversationally, the assistant resolves your AgntUX project, connects
  to the folder if it isn't mounted yet, and reads the right places
  (`entities/`, `actions/`, `user.md`) — instead of guessing or scanning your
  whole disk. No change to syncing or draft handling.

## [4.2.4] — 2026-06-03

### Changed

- **Plain-language listing and README copy.** Rewrote the tagline, description,
  `supported_prompts`, and README intro for non-technical readers — dropped
  internal terms ("knowledge store", "ingest pass", "first token", "cursor",
  "entities", `<thread_id>`). No behaviour change.

## [4.2.3] — 2026-05-28

### Fixed

- **`cold-start.test.ts` no longer fails on the shipped cadence copy.** The
  `recommended_ingest_cadence describes hourly cadence` test asserted the value
  matched `/hour/`, but the shipped manifest phrases the hourly rhythm as
  `"Every 60 min, …"`, so the assertion was red. Broadened the matcher to
  `/hour|60 ?min/` so the human-readable cadence copy and the test agree. No
  behaviour change — test-only. Surfaced by agntux-build 0.14.0's new
  deterministic submission gate, which runs each plugin's full vitest suite.

## [4.2.2] — 2026-05-21

Republish at fresh tag. No source changes — pairs with the agntux/app
remote MCP loader's pin-resolver requirement that `agntux-gmail@${version}`
tags point at a commit containing the rebuilt `view-tool/dist/` tree.

## [4.2.1] — 2026-05-18

### Changed

- **`agntux_gmail_compose_view` handler now ships a `content[].text`
  block alongside `structuredContent`** on every return — success
  and error branches alike. Text built from
  `renderConfirmationText("AgntUX Gmail reply composer")`
  (centralized in `@agntux/plugin-runtime` 0.2.1). The tool's
  `description` was reframed in the same pass: the old forbid-list
  framing ("Once this UI is rendered … do NOT add any chat
  commentary …") became an explanation of the MCP Apps lifecycle,
  and the Stage-2 sentence about the Gmail connector's draft
  response now reads "surface the connector's success/error as
  plain chat text" rather than a list of forbidden re-renders.

### Why

Production bug observed in Claude Cowork on 2026-05-18: after a
view tool fired and the host rendered its iframe, the model
followed up with duplicate widgets and paragraphs of commentary
because nothing in the tool response told it the host had already
materialized the UI. The `content[].text` block plus reframed
descriptions give the model an architecture-level mental model so
the correct "end turn" behavior follows naturally. PATCH-level:
no payload or schema change.

## [4.2.0] — 2026-05-18

### Changed

- **`recommended_ingest_cadence` constrained to working hours.** Now
  reads `Every 60 min, 7am–7pm weekdays local` (previously
  `Hourly`). Aligns with the new repo-wide default — scheduled jobs
  run only during the user's normal working hours unless the source
  genuinely needs out-of-hours coverage.
- **Action-button host_prompts migrated to bare slash-command form.**
  Skill reference compose-payload (both rendered and `_overrides/`)
  now emits `host_prompt: "/agntux-gmail open the reply composer for
  action {id}"` instead of the legacy `"ux: Use the agntux-gmail
  plugin to open the reply composer for action {id}."`. The 4.0.0+
  marketplace schema accepts both forms, so action items already on
  disk continue to route — but every newly-synced action emits the
  bare-slash form. The `agntux_gmail_compose_view` description's
  trigger-phrase list now recognises both shapes.
- **`agntux_gmail_compose_view` description instructs the host to
  stop after rendering.** Explicit no-chat-commentary / no-further-
  tool-calls suffix added so the model doesn't summarise the iframe
  on top of itself.
- **Compose envelopes now suppress Gmail's native draft MCP App UI.**
  `buildEnvelope()` in `view-tool/src/lib/build-envelope.ts` appends
  a directive telling the host to call `create_draft` programmatically
  and return the resulting draft link as plain chat text — not to
  render Gmail's native draft UI on top of the AgntUX compose
  iframe. New tests at
  `view-tool/src/__tests__/lib/build-envelope.test.ts` lock in the
  directive's presence.
- **Iframe-height floor + initial size signal.** `compose-ui.tsx`
  now sets a 480px `min-height` on `document.documentElement`,
  `document.body`, and `#root` BEFORE mount. The vendored
  `simple-mcp-app.ts` emits one initial `ui/notifications/
  size-changed` synchronously when `setupSizeChangedNotifications()`
  runs. Hosts that lock the iframe to a small default on first
  paint now receive the larger signal before they commit.

## [4.1.0] — 2026-05-17

### Added

- **Rich compose iframe restored.** The interactive React surface
  the P5 architecture migration accidentally collapsed into a
  ~70-line slim placeholder is now back. The iframe renders the
  full Gmail `MainComponent` (recipients fields, drafted-body
  editor, email-context disclosure, send/save-to-drafts controls)
  with theme + safe-area integration and streaming partial-input
  handling — the same UI the pre-P5
  `ui-handlers/compose/component/` shipped. Architectural delivery
  path is unchanged (view-tool emits one inlined HTML resource,
  ~213 kB, served from the remote MCP registry).
- Vendored `@agntux/ui-primitives` + `jose` into the view-tool.

### Changed

- `view-tool/package.json`: `tsc` is now `--noEmit` (esbuild owns the
  runtime bundle); build prefixed with `rm -rf dist &&` so stale
  artifacts can't leak.
- `view-tool/tsconfig.json`: `moduleResolution: Bundler` +
  `allowImportingTsExtensions` for the rich-tree imports.

## [4.0.6] — 2026-05-17

### Fixed

- Compose view iframe now renders with proper styling instead of an
  unstyled-HTML "raw text dump." Tailwind utility classes on
  `compose-ui.tsx` (`p-4`, `text-lg`, `font-semibold`,
  `whitespace-pre-wrap`, …) were dead strings because the
  `view-tool/` bundle had no CSS pipeline. The iframe loads only the
  inlined HTML; external stylesheets are never fetched. Same fix
  and bug class as agntux-core 9.5.7 — see that CHANGELOG entry for
  full context.

  4.0.6 wires `@tailwindcss/vite` v4 into `view-tool/vite.config.ts`,
  adds `view-tool/src/globals.css`, and imports it from
  `compose-ui.tsx`. The single-file Vite plugin inlines the
  JIT-pruned Tailwind CSS into `compose.html` alongside the JS.

  Re-upload `dist-zips/agntux-gmail-4.0.6.zip` to Claude Desktop to
  pick up the fix locally; remote hosts pick it up automatically
  on the next `agntux-gmail@4.0.6` tag fetch.

## [4.0.5] — 2026-05-17

### Added

- Compose view iframe renders an explicit "Couldn't reach the host"
  error when `SimpleMcpApp.connect()` fails instead of staying on
  "Loading…" indefinitely. Same fix as agntux-core 9.5.6.

### Fixed

- `SimpleMcpApp` no longer spams the iframe console with verbose
  per-message logs on every host postMessage. Gated behind
  `window.__MCP_APPS_DEBUG__`. Vendored copy synced from canonical.

## [4.0.4] — 2026-05-17

### Fixed

- Compose view iframe now renders. The iframe entry at
  `view-tool/src/compose-ui.tsx` was listening for
  `data.type === "tool-result"` postMessage events — a shape that
  **never matches** the MCP Apps protocol, which uses JSON-RPC 2.0
  envelopes (`ui/notifications/tool-result`). 4.0.4 wires the
  canonical `SimpleMcpApp` wrapper (vendored at
  `view-tool/src/lib/apps-client/`) which performs the `ui/initialize`
  handshake and dispatches `ui/notifications/tool-result` to
  `ontoolresult`. See agntux-core/CHANGELOG.md → 9.5.4 for the full
  bug-class rationale; the same fix applied here.

  Re-upload `dist-zips/agntux-gmail-4.0.4.zip` to Claude Desktop to
  pick up the fix locally; remote hosts pick it up automatically on
  the next `agntux-gmail@4.0.4` tag fetch.

## [4.0.3] — 2026-05-16

### Fixed

- Compose view tool's served `_meta.ui` envelope now matches the
  MCP Apps spec
  (`modelcontextprotocol/ext-apps/specification/2026-01-26/apps.mdx`).
  4.0.2 fixed the HTML bundle itself but the manifest still emitted
  Web-CSP-directive keys (`default_src`, `script_src`, `style_src`)
  under `_meta.ui.csp` and sandbox-iframe-style keys
  (`allowFollowUp`, `allowFormSubmit`) under `_meta.ui.permissions` —
  neither vocabulary is in the spec. Strict hosts (claude.ai,
  Claude Desktop) rejected the resource with "Unsupported UI resource
  content format" even though the body was valid HTML. The manifest
  now emits the canonical four CSP domain lists (`connectDomains`,
  `resourceDomains`, `frameDomains`, `baseUriDomains`, all empty
  arrays because the bundle is fully inlined) and an empty
  `permissions` object. `@agntux/plugin-runtime`'s manifest schema
  was tightened so the regression is structurally impossible going
  forward.

  Re-upload `dist-zips/agntux-gmail-4.0.3.zip` to Claude Desktop to
  pick up the corrected manifest; remote hosts pick it up
  automatically on the next `agntux-gmail@4.0.3` tag fetch.

## [4.0.2] — 2026-05-16

### Fixed

- Compose view tool no longer ships a JavaScript module renamed to
  `compose.html`. The previous `view-tool/vite.config.ts` pointed
  `rollupOptions.input` directly at the `.tsx` source and relied on
  `output.entryFileNames: "[name].html"` as a renamer.
  `vite-plugin-singlefile` only inlines the bundle INTO an HTML
  document when the rollup input is itself HTML — given a `.tsx`
  entry, Rollup just emitted a JS module with an `.html` extension.
  The MCP App view-tool registered the file with
  `mimeType: "text/html"`; Claude Cowork and MCPJam rejected the
  resource with "Unsupported UI resource content format" because the
  body started with `var Bi={exports:{}}` instead of
  `<!doctype html>`. The build-layer fix landed in `ea050c8d` (May
  16). This release exists to give the host a fresh version string
  so cached `dist-zips/agntux-gmail-*.zip` uploads invalidate.

Re-upload `dist-zips/agntux-gmail-4.0.2.zip` to Claude Desktop to
pick up the corrected `view-tool/dist/ui-resources/compose.html`
(a real `<!doctype html>` document with the bundle inlined).

## [4.0.1] — 2026-05-16

Republish at fresh tag. No source changes — pairs with the agntux/app
remote MCP loader's pin-resolver requirement that `agntux-gmail@${version}`
tags point at a commit containing the rebuilt `view-tool/dist/` bundle.

## [4.0.0] — 2026-05-08

Open source. The plugin relicenses from Elastic License v2 (ELv2) to
Apache License 2.0 and removes the `@agntux/mcp-license` gate from the
MCP server's `tools/call` handler. Solo use is now unconditionally free
with no nag, no degradation, and no pairing prompt. License validation
moves to the upcoming proprietary AgntUX Teams runtime.

### Changed
- Relicensed from Elastic License v2 (ELv2) to Apache License 2.0. See
  the root `LICENSE` and `NOTICE` files.

### Removed
- `@agntux/mcp-license` gate from the MCP server's `tools/call` handler.
- `license_paused` structuredContent error code from
  `agntux_gmail_compose_view` (no longer reachable).

## [3.1.0] — 2026-05-08

Configurable Gmail account slot for multi-account browsers, plus a
pre-composed `Draft a reply` button on every reply-worthy action.
Both gaps surfaced while testing on a session with three Google
accounts signed in: generated `Open in Gmail` URLs landed on `u/0`
regardless of the user's actual inbox slot, and reply-worthy actions
shipped only an `Open in Gmail` row (no `Draft a reply` button) so
the compose iframe was unreachable from the action's chrome.

### Added

- **Configurable `account_index` in `data/instructions/agntux-gmail.md`.**
  Append a new `# Account` section with `account_index: <int>` (e.g.
  `account_index: 2` to pin the inbox at `mail.google.com/mail/u/2/`).
  The sync skill (Step 0) parses it, Step 10's `Open in Gmail` URL
  build prefers the `mail/u/{N}/?idr=inbox/{thread_id}` form when set
  (the only form that reliably routes a multi-account browser to the
  right slot), and the `## Compose payload` body section persists it
  so the compose iframe's Save envelope can route the draft-creation
  link to the same account. Unset → falls back to the previous
  `?authuser=<email>` form, then to omitting the row entirely
  (cold-start). Override semantics live in
  `_overrides/reference/deep-links.md` + `_overrides/step-0-append.md`
  + `_overrides/step-10-append.md`.
- **`Draft a reply` suggested-action button.** Every reply-worthy
  action now ships a pre-composed `Draft a reply` row in
  `suggested_actions` that fires `agntux_gmail_compose_view` directly
  from the action's chrome (no "Do something else" workaround). The
  override at `_overrides/reference/compose-payload.md` declares the
  two standard buttons (`Draft a reply` always; `Open in Gmail` only
  when `gmail_thread_url` is non-null), mirroring agntux-slack's
  shape. The `## Compose payload` body section also gains an
  `account_index` field so the compose iframe lifts it without re-
  reading instructions.

### Changed

- **`buildEnvelope` (compose UI handler) accepts `account_index`** as
  a new parameter and routes the Step 2 chat link through a new three-
  rung ladder: `mail/u/{N}/#drafts/<id>` (when `account_index !==
  null`) → `mail/?authuser=<email>#drafts/<id>` (when `user_email !==
  null`) → `mail/u/0/#drafts/<id>` (cold-start). The threaded
  parameter flows through `useEmitCommit` and the `ComposeCard`
  destructure.
- **`ComposeStructuredContent` and the compose-view tool's
  `outputSchema`** carry the new `account_index: <int | null>` field.
  `parse-action.ts` reads it from the action file's `## Compose
  payload` block (defaulting to `null` for older action files raised
  before this release).

### Notes

- This is MINOR per P15 §5.1 — additive prompt surface (new
  `# Account` section, new suggested-action row, new compose-payload
  field) and additive on-disk shape (the `account_index` field in
  `## Compose payload` is optional and defaults to `null` when
  absent). No breaking changes to existing public surface.
- Existing action files in `~/agntux/actions/` won't retroactively
  gain the `Draft a reply` button or the `account_index` field —
  those need a fresh sync run that re-raises them.

## [3.0.0] — 2026-05-07

Slash-command unification — companion to agntux-core 8.0.0
(cozy-squirrel) and agntux-slack 7.0.0. The plugin's single user-facing
entry point is `/agntux-gmail`, accepting either a sync sub-command or
a natural-language question.

### Changed

- **`/agntux-gmail` is the user-facing surface** (bare or
  `/agntux-gmail sync` runs the ingest pass; any other first token is
  a live NL question answered via the Gmail read MCP tools — no cursor
  advance, no knowledge-store write).
  `marketplace/listing.yaml → supported_prompts` advertises the bare
  form.
- **`skills/sync/` renamed to `skills/agntux-gmail/`** so the skill's
  `name:` matches the plugin slug and the host exposes it as
  `/agntux-gmail`. Internal `resources/` directory renamed to
  `reference/` to align with Anthropic Skills Pattern 2 (domain-specific
  organization).
- **`SKILL.md` is now a slim router (~80 lines).** The procedural body
  (steps 0–11 + preflight + orchestrator gate) lives in
  `reference/sync.md`; honesty rules live in `reference/honesty.md`.
  Per-file table-of-contents added per Anthropic Skills best-practices
  guidance.

### Added

- **`reference/ask.md`** — natural-language live-query handler.
  Read-only: skips the orchestrator gate, never advances a cursor,
  never writes to the knowledge store. Refuses cleanly if the Gmail
  connector isn't configured.

## [2.1.0] — 2026-05-07

Phase 4 of the plugin-architecture sweep — sync skill migrates to the
canonical render pipeline (`scripts/render-skill.mjs`). Companion to
agntux-slack 6.0.1 (Phase 3) and the canonical absorption shipped in
Phase 2.

### Added

- **`skills/sync/_overrides/`** — per-plugin overrides directory.
  `frontmatter.yaml` carries the substitution map; per-section
  `*-append.md` files splice content into canonical's `<!-- append:* -->`
  markers; `resources/*.md` wholesale-replace canonical resources or add
  gmail-only siblings.
- **New gmail-only sibling resources** under `skills/sync/resources/`:
  - `email-context.md` — Step 10.2 procedure (≤500-char preamble from
    prior conversations with the recipient, gated to `response-needed`,
    token-guarded with N=3 prior threads / 1 deep MINIMAL `get_thread`
    call per action / per-person 7-day cache).
  - `denylist.md` — Step 11 sub-step 5 auto-learn procedure for
    `# Sender denylist` (gates: recently-active, already-denylisted,
    always-raise; append-then-slice eviction with `<!-- added: -->`
    metadata).
  - `gmail-triage.md` — Step 6 entity guidance + Step 8 signal layer +
    Step 8a follow-up signals.
  - `contract-lock.md` — Step 0 sub-step 2.5 `schema.lock.json` defensive
    check + interactive self-heal.
- **Canonical-replaced resources**: `fetch.md` (gmail 2-stage discovery
  + per-thread polling), `cursor.md` (inbox + thread layers + worked
  diff), `runbook.md` (gmail-specific failure modes), `deep-links.md`
  (`gmail_thread_url` construction), `compose-payload.md` (gmail-specific
  schema with `recipients` and `reply_to_message_id`).

### Changed

- **`skills/sync/SKILL.md`** is now a build artifact rendered from
  `canonical/prompts/ingest/skills/sync/` + `_overrides/`. Hand-edits to
  the rendered file are caught by lint pass8 (`pass8SkillRender`).
  Rendered length ~492 lines (within the ≤500 budget).
- **Bootstrap heads-up message** moved from inline Step 4 prose to
  `step-4-append.md` — same UX, sourced from the override.
- **Step 11 sub-step 5 (denylist auto-learn)** moved out of SKILL.md
  body into `resources/denylist.md`; `step-11-append.md` carries the
  one-paragraph trigger summary.
- **Step 10.2 (email-context)** moved out of SKILL.md body into
  `resources/email-context.md`; `step-10-append.md` carries the
  one-paragraph trigger summary that points there.

### Notes

- This is MINOR per P15 §5.1 — additive prompt surface (new resources/
  siblings), no breaking change to public surface, no manifest field
  rename. Phase 6 will flip pass8SkillRender from opt-in to mandatory.

## [2.0.0] — 2026-05-07

De-fork sweep (Phase 1 of plugin-architecture cleanup). Companion to
agntux-core 7.0.0 and agntux-slack 6.0.0. Trigger phrases for the view
tool now live inline in the tool `description`; `agents/ui-handlers/`
metadata is deleted.

### Removed

- **BREAKING — `plugins/agntux-gmail/agents/` deleted entirely.** The
  metadata file `agents/ui-handlers/compose.md` is gone; trigger
  phrases (formerly `verb_phrases:`), structured-content shape, and
  resource URI all live inline in
  `mcp-server/src/tools/compose-view.ts` now.

### Changed

- **`suggested_actions[*].host_prompt` shortened.** The verbose
  `ux: Use the agntux-gmail plugin to open the email composer for
  action {id}.` is replaced by `ux: open the email composer for action
  {id}` — the trigger phrases that actually steer routing now live in
  the view tool's `description` field, so the host_prompt only carries
  the action-id reference. Pre-launch only; no on-disk migration is
  required because action files are re-emitted on every sync.
- Step 10 `suggested_actions` rules and the `### §4 contract divergence`
  framing are trimmed; same composition-at-ingest semantics, fewer
  authoring surfaces.

## [1.2.0] — 2026-05-07

### Added

- **Auto-learned `# Sender denylist` in `data/instructions/agntux-gmail.md`.**
  Step 11 sub-step 5 appends a denylist entry whenever a sender's
  messages get noise-filtered ≥3 times in one run AND the sender has
  never had an action raised against them in the last 30 days. Bounded
  to 30 entries; oldest auto-added evicted; user-curated entries
  (no `<!-- added: -->` metadata) are never auto-evicted.
- **Step 5b discovery query now reads the denylist** and appends each
  entry as `-from:<entry>` to Stage 1's query. `# Always raise` rules
  override conflicting denylist entries.
- **`marketplace/templates/instructions-default.md`** — starter
  instructions file shipped at install with empty `# Always raise` /
  `# Never raise` / `# Rewrites` / `# Notes` / `# Sender denylist`
  sections.
- **"What the agntux-core hooks do for you" preamble** before Step 0.
  Surfaces the index/sources/validate/cursor hook contract up front
  so the agent doesn't manually update `_index.md`, `_sources.json`,
  etc. Also documents the Gmail-specific gate ("never call
  `create_draft` — the iframe Save click is the gate").
- **"Bounded lists in state files" block** before Step 0. Replaces
  scattered "trim to last 10" instructions across the steps with one
  declarative cap-and-evict rule (errors list = 10, sender denylist =
  30) that the prompt enforces in-place.
- **Step 0 sub-step 2.5 — `schema.lock.json` defensive check.**
  Mirrors the validator's lookup so the skill can fail fast (or
  self-heal inline on interactive runs) when the lock is missing
  `plugin_contracts["agntux-gmail"]` — typically because Mode B
  hasn't been re-run since this plugin was installed.
- **Tool-result truncation handling** (Step 5b + Step 5c failure
  modes). When the host's MCP layer redirects an oversized response
  to a temp file, log `gmail-tool-result-truncated` and skip the
  affected stage/thread for this run rather than reading the temp
  file.

### Changed

- **Step 5b discovery sweep consolidated from three queries to two.**
  Stage 1 folds `(to:me OR cc:me)` and `label:IMPORTANT` /
  `label:^p1` into one OR'd predicate (one network round-trip
  instead of two), excludes `category:updates` (catches MongoDB
  Atlas, SVB, Ramp, Vanta, npm, Justworks, etc. that the previous
  filter missed), and also excludes the `noreply` family at the
  query layer. Stage 2 (`from:me older_than:3d`) gains a
  `newer_than:30d` upper bound and drops `pageSize` from 50 to 20
  to stay under the host's tool-result budget. Combined with the
  new "discard JSON envelope after summarising" instruction, a
  discovery sweep now lands ~5–7× smaller in working-memory
  context (~6–8k tokens vs. ~42k previously).
- **Step 11 cursor advancement is now transactional.** Cursor and
  `discovery_ts` advance only when every action write this run
  succeeded; on any failure they stay at their pre-run values so the
  next run retries the same window. Express the advance as a diff
  (added/advanced/evicted) so `validate-cursor.mjs` has a clean
  signal. Final summary capped at 200 words.
- **Step 7 reads all affected entity files in a parallel-tool-call
  batch** before any edits — typical run touches 3–6 entities and
  they have no read-time dependency on each other.
- **Entity body section renamed `## Recent Activity` → `## Recent signals`**
  in Step 6 entity template + Step 7 append instruction. Matches the
  contract and the existing entity corpus; the deprecated name was
  drift-prone (slack already drifted; gmail was about to).

### Notes

- This is MINOR per P15 §5.1's version-bump rubric — additive prompt
  surface (new sections, new auto-learn behavior), no breaking
  changes to existing public surface, no manifest-field rename.
- The size-optimization slim-downs anticipated in the plan
  (`structured-splashing-whale.md`) are deferred to a follow-up so
  the SKILL is currently ~1370 lines (up modestly from 1165). The
  follow-up will move the failure-mode taxonomy and detailed
  examples to `RUNBOOK.md` and absorb the generic 12-step framework
  into the canonical SKILL via `STUBS.md` placeholders.

## [1.1.0] — 2026-05-07

### Fixed

- **`skills/sync/SKILL.md` now runs inline** — `context: fork` and
  `agent: general-purpose` are removed from the frontmatter. The
  forked sub-context did NOT inherit the host's "Allow for all
  scheduled runs" working-directory grant, so every scheduled fire
  re-prompted for `/Users/<you>/agntux/` access, the preflight read
  of `user.md` / `data/schema/schema.md` /
  `data/schema/contracts/agntux-gmail.md` /
  `data/learnings/agntux-gmail/sync.md` failed, and the skill
  correctly exited clean (per the documented preflight-fail
  semantics) without advancing the cursor. Mirrors the same fix in
  agntux-slack 5.3.0 and the canonical
  `canonical/prompts/ingest/skills/sync/SKILL.md` template, so any
  plugin scaffolded from the template after this release inherits
  the inline shape.
- **Path-canonicalisation prose softened** in the project-root
  ladder. The earlier copy claimed canonical absolute paths were
  "what makes one allow click hold across all subsequent scheduled
  runs"; the actual load-bearing fix is dropping the fork.
  Canonicalisation is still useful (some hosts key their allowlist
  on the literal path string) but it's a secondary mitigation.

### Changed

- **`__tests__/cold-start.test.ts`**: the frontmatter assertion now
  enforces *absence* of `context:`, `agent:`, and `tools:` rather
  than asserting `context: fork` + `agent: general-purpose`. Pins
  the inline shape against future regression.

### Notes

- This is a behaviour change observable to a user who runs
  scheduled syncs (the prompt-and-bail loop stops); no public
  prompt surface, manifest field, or MCP tool is renamed or
  removed. MINOR per P15 §5.1's version-bump rubric.
- If the prompt still fires after this update, the residual cause
  is upstream Claude Cowork bug
  [#47180](https://github.com/anthropics/claude-code/issues/47180)
  ("Allow for all scheduled runs" doesn't persist) — at that point
  the working-directory grant has to be re-clicked once per
  scheduled-task lifetime, but the in-plugin sub-context layer is
  no longer compounding the issue.

## [1.0.4] — 2026-05-06

### Fixed

- **`tools/call` result `_meta` now emits BOTH the modern nested
  `_meta.ui.resourceUri` AND the legacy flat `_meta["ui/resourceUri"]`
  for `agntux_gmail_compose_view`.** The legacy flat key was already
  present on the tool descriptor, but the call result still only carried
  the nested form, so any host that reads the legacy key off the call
  result (rather than the descriptor) would not see it.

## [1.0.3] — 2026-05-06

### Fixed

- **`_meta.ui.csp.resourceDomains` now includes `"data:"` and `"blob:"`.**
  Empty `resourceDomains` caused Claude Cowork's strict iframe sandbox to
  block `data:` / `blob:` URIs that the bundled single-file Vite output
  relies on, leaving the compose-reply iframe blank. MCPJam doesn't enforce
  the CSP envelope, which is why the view rendered there but not in
  Cowork. Restoring the previously-working CSP defaults.

## [1.0.2] — 2026-05-06

The actual Cowork iframe-render fix matching agntux-core 6.2.3 and
agntux-slack 5.2.2. Prior 1.0.1 attempt was wrong-track.

### Fixed

- **MCP server now advertises the `io.modelcontextprotocol/ui` extension
  capability at initialize time.** Per SEP-1865 §"Client\<\>Server Capability
  Negotiation", MCP Apps is an opt-in extension that MUST be bidirectionally
  negotiated during `initialize`. Without the server-side advertisement,
  Claude Cowork silently disabled MCP Apps for this server's tools and fell
  back to text-rendering the `structuredContent`. MCPJam was lenient about
  this; Cowork follows the spec strictly. The server now declares
  `extensions: { "io.modelcontextprotocol/ui": {} }` alongside the existing
  `resources` and `tools` capabilities, so the reply composer iframe renders
  in Cowork as well as in MCPJam.

## [1.0.1] — 2026-05-06

Render-fix patch matching agntux-core 6.2.2 and agntux-slack 5.2.1: the
reply composer now opens its iframe in Claude Cowork desktop, not just
MCPJam. (1.0.0 shipped with the same bug the slack and core plugins had.)

### Fixed

- **`agntux_gmail_compose_view` descriptor now declares `outputSchema`.**
  When a tool returns both `content[text]` and `structuredContent`, hosts
  diverge on which channel to surface; the deciding factor is whether the
  descriptor declares `outputSchema`. Without it, Cowork silently
  text-renders the structuredContent and never opens the iframe. The
  schema lists every top-level success-shape key plus `error`, with no
  `required` fields so the structured-error envelope also validates.
  Mirrors the official `scenario-modeler-server` example in
  `modelcontextprotocol/ext-apps`.
- **Descriptor `_meta` now emits both `ui.resourceUri` (modern, nested)
  and `"ui/resourceUri"` (legacy, flat) keys.** Defensive against hosts
  that only read one of the two synonymous keys.
- **Removed bogus `visibility: ["model","app"]` from result `_meta.ui`.**
  Per spec, `visibility` belongs on the descriptor; the default — both
  surfaces can call — needs no annotation. (Inherited from the slack
  template the plugin was scaffolded from.)

## [1.0.0] — 2026-05-06

### Added

- Initial release.
- Hourly Gmail ingest: discovery sweep + per-thread cursor map; bootstrap
  window default of 14 days.
- Triage rules: `to:me` / `cc:me` from real humans, threads where someone
  replied after the user's last message, sent items awaiting reply for ≥3
  days, IMPORTANT-label boost. Skips `category:promotions` /
  `category:social` / `category:forums` and `noreply@` / `notifications@`
  senders by default.
- Step 10.2 — pre-ingest reply-context gathering: searches up to 3 prior
  threads with each related person and synthesises a ≤500-char preamble into
  the action's `## Email context` body section. Token-guarded (≤3 prior
  threads, single MINIMAL `get_thread` call per action, per-person 7-day
  cache, gated on `response-needed` only).
- Cross-source merge protocol: when an open `agntux-slack` action overlaps
  semantically (LLM-judged topic match within a 48h window), the gmail run
  appends a `Draft an email reply` row to the existing action's
  `suggested_actions` plus a `## Cross-source links` body section instead of
  creating a duplicate. Auto-resolution honours sibling sources — replying in
  Slack closes the linked Gmail action.
- Compose UI handler (`ui://gmail-compose`) with editable to/cc/bcc/subject/
  body, "Why this draft?" personalization disclosure, and an "Email context"
  disclosure surfacing prior conversation history. Save button emits a
  two-step Gmail Connector envelope: `create_draft` followed by an "Open in
  Gmail Drafts" link the user clicks to review and Send from Gmail itself.
- License enforcement via `@agntux/mcp-license` gate on the MCP server's
  `tools/call` handler (per `packages/mcp-license/README.md`).
- Tests: cold-start, cursor-map, thread-association, draft-flow, idempotent.
