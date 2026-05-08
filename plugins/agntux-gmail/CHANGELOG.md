# Changelog

All notable changes to **agntux-gmail** are documented here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the version
in `.claude-plugin/plugin.json` MUST match the most-recent version section.

## [Unreleased]

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
