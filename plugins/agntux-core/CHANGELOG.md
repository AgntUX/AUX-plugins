# Changelog

All notable changes to agntux-core are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [9.6.0] — 2026-05-17

### Added

- **Rich triage iframe restored.** The interactive React surface the
  P5 architecture migration accidentally collapsed into a 142-line
  placeholder is now back. The iframe renders the full
  `MainComponent` from the canonical apps-react / apps-client tree
  with theme + safe-area integration, streaming partial-input
  handling, and the host-provided CSS variables — the same UI the
  pre-P5 `ui-handlers/triage/component/` shipped. Architectural
  delivery path is unchanged (view-tool emits one inlined HTML
  resource served from the remote MCP registry); only the React tree
  inside the iframe is now the rich one.
- Vendored `@agntux/ui-primitives` + `jose` dependencies into the
  view-tool package so the restored rich UI's imports resolve.
- Component-level vitest tests (`view-tool/src/__tests__/`) for
  the restored apps-client + main-component surfaces. Coexists
  with the existing `view-tool/__tests__/payload-shape.test.ts`
  regression guard.

### Changed

- Re-anchored marketplace lint pass 12 (`scripts/lint/lint-apps-client-drift.ts`).
  The canonical apps-client now lives at
  `plugins/agntux-core/view-tool/src/lib/apps-client/`; every other
  plugin's vendored copy still has to hash-match. The agntux-core
  plugin-local check is skipped to avoid self-reporting. The
  `EXTRA_COPIES` set drops the obsolete `_template/component/`
  path; only `_template/view-tool/` ships to scaffolded plugins.

### Removed

- Deleted `plugins/agntux-core/ui-handlers/triage/`. The rich UI
  source now lives at `plugins/agntux-core/view-tool/src/` only —
  one source of truth. The old subtree was a redundant pre-P5
  staging area that the P5 migration left behind.

## [9.5.7] — 2026-05-17

### Fixed

- Triage iframe now renders with proper styling instead of an
  unstyled-HTML "raw text dump." The React tree was rendering
  correctly (h1, divs, p) but every Tailwind utility class
  (`p-4`, `text-lg`, `font-semibold`, `border-b`, `space-y-2`, …)
  on `triage-ui.tsx` was a dead string because the `view-tool/`
  bundle had no CSS pipeline — `tailwindcss` was not a dependency,
  `vite.config.ts` had no Tailwind plugin, and `triage-ui.tsx`
  imported no stylesheet. The iframe loads only the inlined HTML;
  external stylesheets are never fetched. Without CSS, the
  browser flowed every `<div>` as a default block and the visual
  result looked like a raw text dump.
- 9.5.7 wires `@tailwindcss/vite` v4 into `view-tool/vite.config.ts`,
  adds `view-tool/src/globals.css` (`@import "tailwindcss";`), and
  imports it from `triage-ui.tsx`. The single-file Vite plugin now
  inlines the JIT-pruned Tailwind CSS into `triage.html` alongside
  the JS so the iframe renders with the intended styling.

  Marketplace lint pass 13 (E28, warning) was added in the same
  pass to prevent this regression class structurally: any view-tool
  whose `*-ui.tsx` references `className=` MUST emit an HTML
  resource with a non-empty inline `<style>` block. The same fix
  shipped to `agntux-slack` 8.0.6 and `agntux-gmail` 4.0.6.

  Re-upload `dist-zips/agntux-core-9.5.7.zip` to Claude Desktop to
  pick up the fix locally; remote hosts pick it up automatically
  on the next `agntux-core@9.5.7` tag fetch.

## [9.5.6] — 2026-05-17

### Added

- Iframe shows an explicit "Couldn't reach the host" error when the
  `SimpleMcpApp.connect()` handshake fails — previously the iframe
  stayed on "Loading…" indefinitely on any connect-side failure
  (handshake timeout, postMessage origin mismatch, JSON-RPC error).
  The `TriagePayload` union gains a `{ connect_error: string }`
  variant which the React tree renders with the underlying error
  message so the user can distinguish "host is slow" from "host is
  unreachable."

### Fixed

- `SimpleMcpApp` no longer spams the iframe console with
  `[SimpleMcpApp] incoming message: …` on every host postMessage in
  production. The log is now gated behind
  `window.__MCP_APPS_DEBUG__`. Reduces console noise to zero on a
  healthy iframe; the debug flag is still available for diagnosis.

## [9.5.5] — 2026-05-17

### Fixed

- Triage view tool no longer surfaces agntux-teams daemon
  conflict-copy files as phantom duplicate rows. When the daemon's
  push detects a 409 (the local file and the server diverged), it
  renames the local file to
  `{stem} ({DisplayName}'s conflicted copy YYYYMMDD-HHmm){ext}` and
  re-pushes — preserving the user's edits in a sibling. The sibling
  keeps the SAME `id:` in frontmatter as the original, so each
  conflicted action surfaced N+1 times in the triage view (once for
  the original, once per surviving conflict copy). A user with a
  history of daemon races was seeing every action item 3× in the
  triage payload before the cap kicked in.

  9.5.5 filters the conflict-copy filename pattern out at
  `isActionFilePath()` so those siblings never enter the scan. The
  regex anchors on the literal "'s conflicted copy YYYYMMDD-HHmm)"
  shape inside parentheses — a user-authored filename containing
  "conflict" anywhere else (e.g. `team-meeting-conflict.md`) is
  unaffected.

  The on-disk / S3 garbage-collection of already-uploaded conflict
  files is a separate cleanup pass — the lingering blobs cost
  storage but no longer pollute the view-tool response.

  Re-upload `dist-zips/agntux-core-9.5.5.zip` to Claude Desktop to
  pick up the filter locally; remote hosts pick it up automatically
  on the next `agntux-core@9.5.5` tag fetch.

## [9.5.4] — 2026-05-17

### Fixed

- Triage view iframe now renders. The view-tool's iframe entry at
  `view-tool/src/triage-ui.tsx` was listening for
  `data.type === "tool-result"` postMessage events — a shape that
  **never matches** the MCP Apps protocol, which uses JSON-RPC 2.0
  envelopes (`{ jsonrpc: "2.0", method: "ui/notifications/tool-result",
  params }`) per the spec at
  `ext-apps/specification/2026-01-26/apps.mdx` (line 413). The host
  delivered the structuredContent correctly, the bare listener
  ignored it, the iframe stayed on "Loading…" indefinitely, and the
  host fell back to chat-rendering the JSON. 9.5.4 wires the
  canonical `SimpleMcpApp` wrapper (vendored at
  `view-tool/src/lib/apps-client/`) which performs the `ui/initialize`
  handshake and dispatches `ui/notifications/tool-result` to
  `ontoolresult`. Same bug class existed in agntux-slack and
  agntux-gmail's compose/canvas iframes and was fixed simultaneously
  in those plugins' 8.0.4 / 4.0.4 releases; the canonical scaffold in
  agntux-build 0.2.3 ships the corrected pattern so new plugins
  inherit the fix.

  Re-upload `dist-zips/agntux-core-9.5.4.zip` to Claude Desktop to
  pick up the fix locally; remote hosts pick it up automatically on
  the next `agntux-core@9.5.4` tag fetch.

## [9.5.3] — 2026-05-17

### Fixed

- Triage view tool's `structuredContent` no longer exceeds the host's
  max-tokens cap. A workspace with the default 30 open actions could
  produce a ~62 KB JSON-RPC tool-result body (each row carried two
  600-char excerpts plus arrays of related entities and suggested
  actions, almost none of which the iframe rendered), at which point
  Claude rejected the result with `result (62,863 characters) exceeds
  maximum allowed tokens` and the triage UI failed to render.
  9.5.3 trims the per-action payload to the six fields
  `agntux-core/triage.html` actually reads (`id`, `title`, `summary`,
  `priority`, `status`, `reason_class`) plus an internal `due_by` the
  iframe ignores but the server uses for sorting — seven keys total.
  Per-handled-row payload is trimmed from six fields to three (`id`,
  `title`, `handled_at`). Typical 30-row worst-case payload is now
  ~17 KB, well under the cap. No iframe-render change for the user —
  the dropped fields were declared on the iframe's `TriageActionRow`
  interface but never bound to any JSX.

  Re-upload `dist-zips/agntux-core-9.5.3.zip` to Claude Desktop to
  pick up the trimmed bundle locally; remote hosts pick it up
  automatically on the next `agntux-core@9.5.3` tag fetch.

### Compatibility

- `last_updated_at` semantics preserved: still the max-of-row
  frontmatter.updated_at across the scanned set (snapshot-time
  fallback when no row carries it). Computed server-side in
  `processActionsDir` and surfaced as a single top-level scalar so
  per-row `updated_at` doesn't ship on the wire.
- S3/remote-fs path is unchanged. The dropped fields were never
  populated from S3 metadata; the trim only affects the local-fs
  rendering side of the wire shape.
- The legacy/aspirational triage component subtree at
  `ui-handlers/triage/component/src/components/main-component.tsx`
  reads several of the dropped fields (`snoozed_until`, `source`,
  `related_entities`, `suggested_actions`, `why_matters_excerpt`,
  `personalization_fit_excerpt`, `created_at`, `updated_at`, plus
  handled-row `priority` / `status` / `outcome`). That subtree is
  NOT the live iframe entry — `view-tools.manifest.json` ships
  `view-tool/dist/ui-resources/triage.html` (built from
  `view-tool/src/triage-ui.tsx`). Any future migration that promotes
  those primitives back to the iframe entry must either restore the
  dropped fields under a paginated detail-fetch shape or rebind to
  the trimmed payload — do not assume the 9.5.2 wire shape will
  return.
- The stale unit test at `mcp-server/__tests__/triage-view.test.ts`
  was already broken pre-9.5.3 (imports a path that doesn't exist
  post the P5 migration). 9.5.3 widens the gap between its
  assertions and the live shape; rewrite is deferred to a separate
  cleanup. A new focused regression-guard suite lives at
  `view-tool/__tests__/payload-shape.test.ts`.

## [9.5.2] — 2026-05-16

### Fixed

- Triage view tool's served `_meta.ui` envelope now matches the MCP
  Apps spec
  (`modelcontextprotocol/ext-apps/specification/2026-01-26/apps.mdx`).
  9.5.1 fixed the HTML bundle itself but the manifest still emitted
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
  was tightened from `z.record(z.unknown())` to a `.strict()` shape
  that rejects non-canonical keys at build time, so the regression
  is structurally impossible going forward.

  Re-upload `dist-zips/agntux-core-9.5.2.zip` to Claude Desktop to
  pick up the corrected manifest; remote hosts pick it up
  automatically on the next `agntux-core@9.5.2` tag fetch.

## [9.5.1] — 2026-05-16

### Fixed

- Triage view tool no longer ships a JavaScript module renamed to
  `triage.html`. The previous `view-tool/vite.config.ts` pointed
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
  so cached `dist-zips/agntux-core-*.zip` uploads invalidate.

Re-upload `dist-zips/agntux-core-9.5.1.zip` to Claude Desktop to
pick up the corrected `view-tool/dist/ui-resources/triage.html`
(a real `<!doctype html>` document with the bundle inlined).

## [9.5.0] — 2026-05-16

### Changed

- `agntux_core_triage_view`: rewrites the action-scan to use the new
  `ViewToolFs.listWithMeta` + `readMany` APIs from
  `@agntux/plugin-runtime@0.2.0`. The previous implementation read
  every file in `actions/` sequentially and filtered by status in
  memory; for a workspace with 1000 actions of which 30 are open and
  5 are recently handled, that meant ~1000 sequential S3 GETs
  (20+ seconds of render latency). The new implementation pushes the
  status / handled-cutoff filter through `listWithMeta`'s metadata
  index, then batches the remaining ~35 body fetches in parallel
  through `readMany` (concurrency cap 16 in the S3 backend). Cold-cache
  call: ~1.4s; warm cache: ~50ms.
- New `shouldFetchForTriage(meta, cutoff)` predicate centralises the
  "is this row worth a body fetch?" decision. Open / snoozed always
  pass; done / dismissed pass only if handled within the cutoff;
  unknown status is excluded. Null meta (cold cache) passes — legacy-
  safe behaviour while the cache fills.
- `isActionFilePath` extraction is now a top-level helper, exported
  for direct testing. No behavioural change to the rendered output.

## [9.4.0] — 2026-05-16

Promotes the `agntux_core_sync_installed_plugins` tool + connector-refresh
nudge from the prior `[Unreleased]` queue to a tagged release. Required
to align the published `agntux-core@9.4.0` tag with the rebuilt
`mcp-server/dist/` + `view-tool/dist/` artifacts the remote MCP loader
fetches; the previous `9.3.0` tag pre-dated those dist commits and so
resolved to a tree without the view-tools manifest.

### Added

- `agntux_core_sync_installed_plugins`: new MCP tool. Writes
  `~/.agntux/installed-plugins.json` atomically (tmp + rename) with a
  `{schema_version: 1, generated_at, plugins[]}` envelope. Each plugin
  entry carries `{slug, marketplace, version?, source_sha?}`. The skill
  calls this tool whenever it enumerates Claude's installed plugins
  (preconditions §0.5 + onboard Stage 4.6 + re-entry reconciliation),
  passing the COMPLETE list so the file mirrors the host's current
  state — the writer replaces, never patches. agntux-core is now the
  canonical reader of Claude's local install state: the agntux-teams
  daemon watches `~/.agntux/installed-plugins.json` with chokidar and
  POSTs the snapshot to AgntUX, so the remote MCP connector surfaces
  view-tools for each installed plugin. Anthropic format changes only
  ever touch this one tool. Home-scope file (not project-scope) — the
  daemon and the user's install set are per-user, not per-project.
  Test seam: `AGNTUX_HOME_OVERRIDE` redirects the writes during unit
  tests without depending on HOME env-var overrides (vitest's runtime
  ignores HOME for `os.homedir()`).
- Skill nudge — whenever the plugin-reconciliation pass adds a new
  slug to `## Installed` (i.e. the host installed a plugin since the
  last `/agntux-*` invocation), the skill now emits a one-line
  instruction telling the user how to surface the new plugin's
  view-tools on the AgntUX connector in Claude Desktop:
  *Settings → Connectors → AgntUX → three-dot menu → "Refresh tools
  list"*. Required because the remote MCP server snapshots the
  installed-plugin set at session-init time; a freshly-added plugin's
  tools only appear after a connector refresh.

## [9.3.0] — 2026-05-12

P9 personalization + triage. Adds per-team / per-member relevance
filtering, a team-wide mark-done attribution surface, and the personal
snooze + dismiss migration into a single triage-prefs.json file.
Schema bumps: personal action schema 1.1.0 → 1.2.0 (deprecates
`snoozed_until` / `dismissed_at` on personal frontmatter — readers
tolerate them on legacy files, new writers go to triage-prefs.json);
triage-prefs schema 1 → 2 (new shape). Solo-mode payload remains
byte-identical to 9.1.0 when `<root>/.agntux/teams.json` is absent.

### Added

- `agntux_core_set_status`: optional `user_slug` and `user_id`
  arguments. When status flips to `done` on a team or leader-view
  scope, the tool writes `done_by_user_slug`, `done_by_user_id`, and
  `done_at` to the action file's frontmatter. After P5 sync, every
  team member's triage UI sees who closed the item and when. On
  personal scope these args are ignored; on re-open / dismiss /
  snooze the attribution fields are cleared. The `user_slug` arg is
  validated against the strict lowercase-alphanumeric-with-dashes
  pattern; `user_id` is accepted as an opaque string up to 128 chars.
- `agntux_core_save_triage_prefs`: v2 schema with `team_filters`,
  `view_filters`, `relevance_class_filters`, `sort`, and `show_done`
  / `show_snoozed` / `show_dismissed` toggles. Patch-style merge —
  callers can patch a single key without re-sending the whole state.
  The legacy `muted_team_slugs` / `muted_view_slugs` arrays remain
  accepted and round-trip into the new map for backward compat with
  older bundles.
- `agntux_core_set_triage_pref`: new MCP tool. Writes per-path
  snooze / dismiss state to `triage-prefs.json`'s `triage_state` map.
  Path is validated against the strict `actions/*.md`,
  `teams/{slug}/actions/*.md`, or `leader-views/{slug}/actions/*.md`
  pattern before write. Passing `null` for both `snoozed_until` and
  `dismissed_at` removes the entry.
- `agntux_core_triage_view`: in team mode, the payload gains
  `triage_prefs` (the v2 prefs JSON), `self_user_slug` /
  `self_user_id` (read from `teams.json`), and per-team
  `member_relevance_classes[]` (read from
  `<root>/teams/{slug}/data/members/{self_user_slug}.md`). Rows gain
  `relevance_classes[]`, `relative_path`, and team-wide done
  attribution fields (`done_by_user_slug`, `done_by_user_id`,
  `done_at`). All additions are gated on team mode being active —
  solo payload stays byte-identical to 9.1.0.
- Triage UI: per-team relevance-class filter chips inside each team
  section (pre-selected from the member's onboarding picks). Chip
  toggles persist to `prefs.relevance_class_filters[teamSlug]` —
  they do NOT modify the member file. Strict-intersection filter
  (`member.relevance_classes ∩ item.relevance_classes ≠ ∅`)
  determines which items render; falls through to "show all" when
  the member hasn't onboarded for the team yet (pre-onboarding
  compatibility — the "Set your relevance picks for {Team}" CTA
  surfaces alongside the items in this case).
- Triage UI: bottom toggle bar — "Show done", "Show snoozed",
  "Show dismissed". Reveal items the personal-prefs filter is
  hiding. Each toggle persists to its own boolean in
  `triage-prefs.json`.
- Triage UI: sort dropdown gains "Team, then priority" and "Due
  date, then priority" options. Sort persists to `prefs.sort`.
- Triage UI: snooze and dismiss buttons on every row now write to
  `triage-prefs.json` (per-path, personal) via the new
  `agntux_core_set_triage_pref` tool. Team-scoped action files stay
  untouched, so Alice's dismissal of a team item does not affect
  Bob's view. Mark-done remains an action-file mutation
  (team-wide for team scope, personal for personal scope).
- Triage UI: per-team empty-state copy "All caught up for {Team}."
  when the strict-intersection filter empties an originally
  non-empty section.

### Changed

- MCP server `PLUGIN_VERSION` bumped 9.2.0 → 9.3.0 to match the
  plugin manifest.
- `data/schema-template/actions/_index.md`: bumped 1.1.0 → 1.2.0.
  `snoozed_until` and `dismissed_at` on personal action frontmatter
  are marked deprecated (still readable; new writes go to
  triage-prefs.json). The "schema_version history" section was
  added to document the 1.0.0 → 1.1.0 → 1.2.0 lineage. New required-
  conditional fields documented for team and leader-view scopes:
  `done_by_user_slug`, `done_by_user_id`, `done_at`.

### Notes

- **Solo behavior is byte-identical to 9.1.0.** With no
  `<root>/.agntux/teams.json`, the triage_view payload, mutator-tool
  behavior, and on-disk artifacts are exactly as they were in
  9.1.0. Verified by the byte-identical regression tests in
  `mcp-server/__tests__/triage-view.test.ts` and the solo render
  guards in `ui-handlers/triage/component/src/__tests__/components/`.
- **Migration of legacy frontmatter snooze / dismiss.** Personal
  schema 1.2.0 ships with `snoozed_until` and `dismissed_at` marked
  deprecated. Readers prefer the prefs value when both signals are
  present. A maintenance pass to lift remaining frontmatter values
  into triage-prefs.json and drop the deprecated fields is
  scheduled for 90 days post-1.2.0 — out of scope for this release.
- **Pre-onboarding fallback.** A member who hasn't run
  `/agntux-teams onboard:member {team-slug}` has no
  `relevance_classes` in their member file (or the file is absent).
  The triage UI shows ALL team items in that case alongside the
  "Set your relevance picks…" CTA so the user can act on items
  immediately while being prompted to onboard.

## [9.2.0] — 2026-05-12

Team-aware additions (P3 v2 §1, sub-plan S3.2). Adds team-mode awareness to
the public `agntux-core` plugin, gated entirely on the presence of
`<root>/.agntux/teams.json`. Solo behavior is byte-identical to 9.1.0
when the gate file is absent — the gate is purely additive and there is
no license check, no nag, and no behavioral drift in the solo path.

### Added

- `agntux_core_triage_view`: when `<root>/.agntux/teams.json` exists and
  carries at least one membership or leader-view, the payload gains
  `schema_version: 2` plus three structured sections — `personal`,
  `teams[]`, `leader_views[]` — alongside the existing top-level keys
  (kept populated as personal-only for backward compat with older
  bundle versions). Each section carries its own `actions[]` and
  `handled_recent[]` arrays, independently capped at 30 / 10.
- `agntux_core_triage_view`: action rows from a team scope are
  decorated with optional `team_slug`, `team_id`, `source_team`, and
  `member_relevance_class` fields read from frontmatter (or inferred
  from the scope's parent directory). These fields are entirely
  omitted from personal rows so the solo payload stays
  byte-identical.
- `agntux_core_snooze` / `agntux_core_dismiss` / `agntux_core_set_status`:
  optional `team_slug` and `view_slug` arguments. When set, the mutator
  routes to `<root>/teams/{team_slug}/actions/` or
  `<root>/leader-views/{view_slug}/actions/` instead of personal.
  Mutually exclusive. Slugs and ids are validated against strict
  patterns before joining into the path; the resolved path is
  re-checked against the canonical `dir + id.md` shape so any
  traversal that slipped past the regex still rejects.
- `agntux_core_save_triage_prefs`: new MCP tool. Writes
  `<root>/.agntux/triage-prefs.json` (filter state — muted team /
  view slugs). Called by the triage UI when the user toggles a team
  filter chip; not user-facing. P9 will extend this file's shape.
- `data/schema-template/actions/_index.md`: documents four new
  optional action-frontmatter fields (`team_id`, `team_slug`,
  `source_team`, `member_relevance_class`). Additive against
  `schema_version 1.1.0`; existing validators accept them because
  the lock declares them as optional.
- Triage UI: when the payload carries `teams[]` or `leader_views[]`,
  renders up to three stacked sections (My items / Team items /
  Leader views) with mute chips above the list for each team and
  leader view. Each team-scoped row carries a small team-name chip;
  rows with `member_relevance_class` set get a left-edge ribbon.
  Filter state persists to `triage-prefs.json` via the new tool.

### Changed

- MCP server `PLUGIN_VERSION` bumped from 9.1.0 → 9.2.0 to match the
  plugin manifest.
- `triage_view`: `last_updated_at` now picks the most-recent
  `_index.md` mtime across every scope (personal + teams +
  leader-views) when team mode is active, so the UI's "Updated
  X ago" reflects the freshest signal in any scope. Solo behavior
  unchanged — still reads the personal `_index.md` only.

### Notes

- **Solo behavior is byte-identical to 9.1.0.** With no
  `<root>/.agntux/teams.json`, the triage_view payload,
  mutator-tool behavior, and on-disk artifacts are exactly as they
  were in 9.1.0. Verified by the `solo-byte-identical` regression
  test in `mcp-server/__tests__/triage-view.test.ts`.
- **No license gate.** The team-aware code paths in this Apache-2.0
  plugin do not check `license_jwt`. The license gate lives in the
  proprietary `agntux-teams` plugin's preflight and in the web-app
  backend per P11. Users assembling a `teams.json` by hand can run the
  team UI unconditionally.

## [9.1.0] — 2026-05-12

P7 schema additions (sub-plan S3.1). Promotes three frontmatter fields to
required on every entity file and one field on every action file at
`schema_version 1.1.0`, all hook-enforced. The change is additive and
self-heals via the existing PreToolUse runbook loop — no one-shot
migration is involved, and the `agntux-teams` plugin's gate is still
inert in the public marketplace tree, so the team-aware code paths
remain dormant until that plugin's per-Org renderer lands.

### Added

- `canonical/hooks/lib/entity-id.mjs` — new helper exporting
  `computeEntityId(source, sourceRef)` and `isWellFormedEntityId(value)`.
  `entity_id = sha256(source + ":" + source_ref).slice(0, 16)`. A
  byte-frozen copy lives at `plugins/agntux-core/hooks/lib/entity-id.mjs`;
  S3.4's `canonical/teams/agntux-teams/hooks/lib/` carries the same
  helper. A vitest pin asserts the canonical / agntux-core pair stays
  byte-identical.
- `plugins/agntux-core/hooks/lib/scope.mjs` — path-scope resolver that
  classifies a write as personal / team / leader-view, plus
  `schemaDirForScope` for the team-aware lock lookup.
- `hooks/lib/schema-lock.mjs` — `readSchemaLockAt(lockPath)` reads any
  scope's lock with per-path TTL caching; the legacy `readSchemaLock()`
  remains and delegates to the personal lock path.
- `validate-schema.mjs` — entity files now require `entity_id`, `source`,
  and `source_ref`; action files now require `entity_refs`. The hook
  computes the expected `entity_id` from `source` + `source_ref` and
  emits a rejection runbook quoting the correct value when the field
  is missing or wrong. **The LLM never computes the hash** — the
  runbook is the only way the correct value reaches the file. Team-
  scope writes (`<root>/teams/{slug}/entities/...` and
  `.../actions/...`) validate against the team's own
  `data/schema/schema.lock.json`.
- `validate-write-lane.mjs` — when `agntux-teams` holds the active
  ingest lock, the hook now permits writes under
  `<root>/teams/{slug}/entities/...`, `<root>/teams/{slug}/actions/...`,
  and `<root>/leader-views/{slug}/actions/...`. Source plugins remain
  team-unaware: a write to those subtrees by `agntux-slack`,
  `agntux-gmail`, or any other source plugin still rejects with the
  team-lane runbook. Leader-views have no entities subtree (P7) — even
  `agntux-teams` cannot write `<root>/leader-views/{slug}/entities/...`.
- `validate-contract.mjs` — recognises team-scope contract files at
  `<root>/teams/{slug}/data/schema/contracts/*.md` and reads the
  scope-correct lock for the reason_class-enum membership check.
- `lint-entity-shape.mjs` — broadened to lint team-scope entity files
  too (the deprecated `## Recent Activity` → `## Recent signals`
  guidance applies regardless of scope).
- `data/schema-template/schema.md` — bumped to `schema_version 1.1.0`
  with an additive-only versioning policy documented inline (no MAJOR
  bumps, ever — schemas evolve via the hook+runbook self-heal loop).
- `data/schema-template/entities/{person,company,project,topic}.md`,
  `entities/_index.md`, `actions/_index.md` — schema_version bumped
  to `1.1.0`; new required fields documented.
- `__tests__/entity-id.test.mjs` — unit tests for the helper plus a
  byte-freeze pin against the canonical copy.
- `__tests__/validate-schema.test.mjs` — new coverage for entity_id
  missing / wrong / correct trio, team-scope lock validation, and
  pre-bootstrap team passthrough.
- `__tests__/validate-write-lane.test.mjs` — new coverage for
  agntux-teams permitted lanes, source-plugin rejection against
  team subtrees, and the leader-views-have-no-entities invariant.

### Notes

- **Solo behaviour unchanged on existing 1.0.0 corpora.** Files at
  `schema_version: "1.0.0"` are accepted as-is (contract-ahead MINOR
  drift passes silently). The next write to any such entity surfaces
  the runbook and the file picks up the new shape additively.
- **No MAJOR bumps.** P7 ratifies the additive-only schema policy; the
  authoring flow rewrites breaking proposals as additive deprecations
  before they reach the validator. Users never have to manually run a
  migration.

## [9.0.0] — 2026-05-08

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
  The plugin no longer reads or writes `~/.agntux/.license` /
  `~/.agntux/.pairing`.
- `license_paused` structuredContent error code from
  `agntux_core_triage_view` (no longer reachable).
- Trial-banner / paused-banner instructions from `_preconditions.md` and
  the orchestrator router skill.

## [8.0.0] — 2026-05-07

Skill consolidation. The eight separate `agntux-*` skills (~1,800
lines of body across 8 frontmatter blocks in the host's cold-start
"available skills" surface) collapse into a single `/agntux` entry
point organised per Anthropic's progressive-disclosure pattern: a slim
~120-line router at `skills/agntux/SKILL.md` plus
`skills/agntux/reference/*.md` resources loaded only when a specific
sub-task engages. The model pays the cold-start cost for one skill
description; the heavy bodies are loaded on demand.

### Changed

- BREAKING: All `agntux-core` slash commands consolidated into a
  single `/agntux` entry point. Migration:

      /agntux-onboard           → /agntux onboard
      /agntux-profile           → /agntux profile
      /agntux-schema            → /agntux schema
      /agntux-teach {slug}      → /agntux teach {slug}
      /agntux-sync {slug}       → /agntux sync {slug}
      /agntux-ask {…}           → /agntux ask {…}
      /agntux-feedback-review   → /agntux feedback-review
      /agntux-triage (digest)   → /agntux triage-digest

  The interactive triage UI is unchanged — it's now invoked directly
  by the host's tool selector matching the `agntux_core_triage_view`
  tool description's trigger phrases (`show triage`, `what's hot`,
  etc.). Users with existing scheduled tasks must update prompt
  bodies from `/agntux-feedback-review` to `/agntux feedback-review`
  and `/agntux-triage` to `/agntux triage-digest`.

### Removed

- Eight skill directories (`skills/agntux-{ask,feedback-review,onboard,profile,schema,sync,teach,triage}/`) replaced by `skills/agntux/SKILL.md` + `skills/agntux/reference/*.md`.
- `disable-model-invocation: true` frontmatter — the equivalent
  guard now lives inside `reference/feedback-review.md` and
  `reference/triage-digest.md` as a refuse-and-redirect on
  interactive context.

### Added

- `skills/agntux/` — single skill directory with progressive-
  disclosure resource layout per Anthropic's skill spec.
- `/agntux sync {bare-name}` — resolves bare names like `slack` to
  `agntux-slack` when exactly one installed plugin matches.

## [7.0.1] — 2026-05-07

Skill quality pass (Phase 5 of plugin-architecture cleanup). No
behavioural change — every edit is structural cleanup that future
authoring guards against drift.

### Changed

- **Reference-chain flattened.** `_preconditions.md` § B Check 0 no
  longer links to `_resolve-root.md` (was a 2-level chain
  `SKILL.md → _preconditions.md → _resolve-root.md` that violated
  Anthropic's one-level-deep rule). Each of the 8 entry-point
  `agntux-*` skills now links `_resolve-root.md` directly from its
  preconditions block, so the chain is one level deep from any
  SKILL.md.
- **TOCs added** to the two long shared sibling files
  (`_preconditions.md`, `_resolve-root.md`) so partial reads see the
  structure. Anthropic's best-practices guide flags this for any
  reference file >100 lines.

### Internal

- **Pass8 skill-render lint extended.** Three new always-on
  invariants now fire for every plugin shipping `skills/`:
  per-skill `SKILL.md` ≤ 500 lines, shared `_*.md` ≤ 200 lines,
  and a reference-chain-depth check that errors if any link from a
  `SKILL.md` resolves to a shared sibling that itself links to
  another shared sibling. Catches the 2-level chain regression
  going forward.

## [7.0.0] — 2026-05-07

De-fork sweep (Phase 1 of plugin-architecture cleanup): the six classical
sub-agents that the entry-point skills used to dispatch via `Task` are now
absorbed inline into their owning skills. The `agents/` directory is gone
entirely. Every `/agntux-*` slash command runs as a single inline skill in
the parent dispatch context — no fork, no working-directory grant
re-prompt on scheduled runs.

### Removed

- **BREAKING — `plugins/agntux-core/agents/` deleted entirely.** Six
  classical sub-agents — `retrieval`, `personalization`, `data-architect`,
  `pattern-feedback`, `user-feedback`, `_sources` — and the
  `ui-handlers/triage` metadata file are gone. Consumers that invoked
  these via `Task({subagent_type: ...})` must now invoke the equivalent
  slash command:
  - `retrieval` → `/agntux-ask`
  - `personalization` (Mode A — onboarding interview / Stage 0) → `/agntux-onboard`
  - `personalization` (Modes B/C/D — ongoing profile updates) → `/agntux-profile`
  - `data-architect` (all modes) → `/agntux-schema`
  - `pattern-feedback` → `/agntux-feedback-review`
  - `user-feedback` → `/agntux-teach`
- **BREAKING — `agents/ui-handlers/triage.md` deleted.** The view tool's
  `description` field in `mcp-server/src/tools/triage-view.ts` is now the
  single source of truth for the trigger phrases that fire it
  (`/agntux-triage`, `show triage`, `what's hot`, etc.).

### Changed

- **`agntux_core_triage_view` inputSchema is now empty** (zero arguments).
  The previously-optional `view_handled_days` and `limit` fields are
  dropped; server-side caps (DEFAULT_HANDLED_DAYS, DEFAULT_LIMIT) remain
  as constants. Saves the LLM a tool-call argument decision.
- `_preconditions.md` rewords every "dispatch the X subagent in Mode Y"
  line to "route to /agntux-{ask,profile,onboard,schema,feedback-review,
  teach} (it owns Mode Y)". Same effect, no fork.
- `agents/_sources.md` content moves to
  `plugins/agntux-core/skills/_sources.md` (sibling reference, same
  `_`-prefix convention as `_preconditions.md` / `_resolve-root.md`).

## [6.2.5] — 2026-05-06

### Fixed

- **`tools/call` result `_meta` now emits BOTH the modern nested
  `_meta.ui.resourceUri` AND the legacy flat `_meta["ui/resourceUri"]`.**
  The 0437ccb fix added the legacy flat key to the tool *descriptor*
  (`tools/list`) but not to the tool *result* (`tools/call`). Hosts that
  read the legacy key off the call result rather than the descriptor were
  not seeing it, so the iframe was never opened. Mirrors the same dual-key
  shape the `registerAppTool` helper emits in
  `@modelcontextprotocol/ext-apps`.

## [6.2.4] — 2026-05-06

Follow-up to 6.2.3. Iframe still rendered blank in Claude Cowork because the
MCP UI resource declared an empty `_meta.ui.csp.resourceDomains`, which the
host's strict iframe sandbox honours by blocking `data:` and `blob:` URIs
that the bundled single-file Vite output relies on (inlined fonts, blob
workers, etc.). MCPJam doesn't enforce the CSP envelope, which is why the
UI rendered there. Restoring the previously-working defaults.

### Fixed

- **`_meta.ui.csp.resourceDomains` now includes `"data:"` and `"blob:"`.**
  Matches the shape the legacy backend MCP server (deleted in app commit
  `2410a9c`) merged in via `applyDefaultCspToMetaMcpApps()` — the
  configuration that was working in Cowork before the migration to host
  plugins.

## [6.2.3] — 2026-05-06

The actual Cowork iframe-render fix. Prior 6.2.2 attempt was wrong-track —
adding `outputSchema` and the legacy `_meta["ui/resourceUri"]` flat key
didn't address the real problem.

### Fixed

- **MCP server now advertises the `io.modelcontextprotocol/ui` extension
  capability at initialize time.** Per SEP-1865 §"Client\<\>Server Capability
  Negotiation" and SEP-1724 §"Negotiation", MCP Apps is an opt-in extension
  that MUST be **bidirectionally** negotiated during `initialize`. Both the
  host and the server have to declare support in the `extensions` field of
  their respective capabilities. Our server only declared
  `capabilities: { resources: {}, tools: {} }` — no `extensions` block — so
  spec-conformant hosts (Claude Cowork desktop) silently disabled MCP Apps
  for this server's tools and fell back to text-rendering the
  `structuredContent` payload in chat. MCPJam renders the iframe without the
  handshake (lenient), which is why /agntux-triage worked there but not in
  Cowork. The server now declares `extensions: { "io.modelcontextprotocol/ui": {} }`
  alongside the existing `resources` and `tools` capabilities.

## [6.2.2] — 2026-05-06

Render-fix patch: `/agntux-triage` now opens the iframe in Claude Cowork
desktop, not just MCPJam. Previously Cowork dumped the structuredContent
JSON into chat instead of rendering the triage UI.

### Fixed

- **`agntux_core_triage_view` descriptor now declares `outputSchema`.**
  When a tool returns both `content[text]` and `structuredContent`, hosts
  diverge on which channel to surface; the deciding factor is whether the
  descriptor declares `outputSchema`. Without it, Cowork (and per the
  upstream app project's `c023186` fix, ChatGPT) silently text-render the
  structuredContent and never open the iframe. The `outputSchema` lists
  every top-level success-shape key plus `error`, with no `required`
  fields so the structured-error envelope (`{error: ...}`) also
  validates. Mirrors the official `scenario-modeler-server` example in
  `modelcontextprotocol/ext-apps`, which has the same shape we do
  (content[text] + structuredContent + ui:// iframe).
- **Descriptor `_meta` now emits both `ui.resourceUri` (modern, nested)
  and `"ui/resourceUri"` (legacy, flat) keys.** The MCP Apps spec defines
  these as synonymous; the upstream `registerAppTool` helper in
  `@modelcontextprotocol/ext-apps` populates both, so we do too —
  defensive against any host that only reads one of them.
- **Removed bogus `visibility: ["model","app"]` from result `_meta.ui`.**
  Per spec, `visibility` belongs on the descriptor (and its values are
  things like `["model"]` to make a tool model-only). The default — both
  surfaces can call — needs no annotation, so the field was just noise on
  the result envelope.

### Tests

- New regression guard asserts the descriptor's `_meta` carries both the
  modern and legacy `resourceUri` keys.
- New regression guard asserts the descriptor declares `outputSchema`
  with the expected top-level keys (`actions`, `handled_recent`,
  `counts`, `last_updated_at`, `bootstrap_mode`, `error`) and no
  `required` fields, so both the success payload and the structured-error
  envelope validate.

## [6.2.1] — 2026-05-06

Build-only fix for hosts that launch `mcp-server/dist/index.js` without
running `npm install` first (Claude Cowork desktop, and any other host
that follows the marketplace "no install step" contract documented in
this repo's `CLAUDE.md`).

### Fixed

- **`mcp-server/dist/index.js` is now a self-contained esbuild bundle.**
  Previously the build was `tsc && embed-bundle.mjs`, which only
  transpiled TypeScript and left bare `import "@agntux/mcp-license"` /
  `import "@modelcontextprotocol/sdk"` / `import "yaml"` statements in
  the dist. When a host extracted the plugin without installing the
  shared `packages/mcp-license/` workspace package or `node_modules/`
  (the marketplace path), Node failed at the first import with
  `ERR_MODULE_NOT_FOUND` and the MCP server crashed silently — skills
  still surfaced (slash commands worked) but `agntux_core_*` tools were
  invisible to chats. The build now runs `tsc` (still emits per-file
  `dist/*.js` so sibling plugins like agntux-slack can resolve the
  `./agntux-root` subpath export at *their* build time) and then
  `esbuild --bundle` to overwrite `dist/index.js` with a single
  self-contained ~1.2 MB bundle that inlines `@agntux/mcp-license`,
  `@modelcontextprotocol/sdk`, `yaml`, and all transitive workspace
  deps. Verified by running the bundle from a scratch directory with no
  `node_modules/` and no co-located `packages/` — exit 0 on stdin
  close.
- **`embed-bundle.mjs` placeholder substitution still runs after the
  esbuild step.** The `__EMBED__<ui-name>__INDEX_HTML__` placeholders
  emitted by `ui-resources/*.ts` survive bundling as ordinary string
  literals; `embed-bundle.mjs` walks `dist/*.js` (now just the bundle,
  plus the orphan transpiled files used at sibling build time) and
  substitutes the base64'd component HTML in-place.
- **`scripts/check-bundle-sync.mjs` is now scoped to its own plugin.**
  Each plugin has its own copy of the script under
  `mcp-server/scripts/`. The script now derives the plugin slug from
  its own filesystem location and validates only that plugin's dist —
  prevents a false positive when `build-plugin.mjs` rebuilds plugins
  serially (the next plugin's dist is briefly empty mid-run because the
  build now starts with `rm -rf dist`).

### Internal

- Bumped esbuild ^0.24.0 into `mcp-server/devDependencies`. No new
  runtime dependency.

## [6.2.0] — 2026-05-06

Internal refactor only — no user-visible behaviour change.

### Changed

- **Shared UI primitives moved to `@agntux/ui-primitives`.** The triage
  handler now imports `ScrollablePanel`, `AgntuxLogo`, `Spinner`,
  `ComponentErrorBoundary`, `LicenseErrorScreen`, `detectErrorEnvelope`,
  and the `safeArray`/`safeString`/`safeNumber`/`safeBoolean`/`safeObject`/
  `safeEnum`/`safeDate`/`formatTime`/`daysSince` helpers from a new private
  workspace package at `packages/agntux-ui-primitives/`. Each handler used
  to ship its own byte-identical copy of these files; centralising them
  prevents the drift that accumulated across handlers.
- **Tailwind content config updated** to scan
  `../../../../../packages/agntux-ui-primitives/src/**/*.{js,ts,jsx,tsx}`
  so the package's utility classes are picked up at build time.

### Removed

- `components/agntux-logo.tsx`, `components/spinner.tsx`,
  `components/error-boundary.tsx`, `components/scrollable-panel.tsx`
  (the latter was already unused in 6.1.0).
- `lib/detect-error-envelope.ts`, `lib/safe-accessors.ts`.
- `__tests__/lib/detect-error-envelope.test.ts` (coverage moved to the
  shared package's own test suite).

## [6.1.0] — 2026-05-06

Triage UX refinements based on user feedback that modals were appearing
~⅓ of the way down the iframe (a stale anchor-clamp interacting badly with
the modal's height-overflow guard) and that toast notifications were
landing far from the resolved row.

### Changed

- **Replaced action-card modals with inline expansion panels.** Clicking
  Details / Snooze / Dismiss / "Do something else…" on an action card
  now expands a panel directly inside the card instead of opening a
  centred (or imperfectly anchored) modal. Eliminates the positioning
  math entirely and keeps the user's place in the list. `ScrollableModal`
  is no longer used and the file is deleted.
- **Replaced toast notifications with in-list feedback rows.** When a
  terminal action (Done / Snooze / Dismiss / "Stop raising items like
  this") resolves an action, the row is replaced *in its slot* by a
  feedback row (e.g., `✓ Marked done · {action title}`) for 5 seconds,
  then drops out of the list. Preserves the user's scroll position and
  gives them a moment to register what just happened. The `Toast`
  component and `toast-success` testid are removed.
- **"Do something else" CTA renamed** from "Send to AgntUX" to
  "Send prompt".

### Removed

- `components/scrollable-modal.tsx` and its test
  `__tests__/components/scrollable-modal.test.tsx`.
- `components/toast.tsx`.

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
