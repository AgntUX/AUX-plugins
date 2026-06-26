# Changelog

All notable changes to agntux-build are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Error telemetry to the `agntux-plugins` Sentry project.** The stdio MCP
  server now reports handler exceptions + uncaught errors via a zero-dependency
  client (`src/sentry-lite.js`, `node:https` only — no new runtime deps), with
  secret/PII scrubbing and no hostname. Opt out with `AGNTUX_DISABLE_TELEMETRY`;
  override the DSN with `SENTRY_DSN_PLUGINS`. `agntux_report_defect` gains an
  optional `submit` (default true) that also ships the scrubbed defect bundle to
  Sentry and returns `sentry_event_id`.

## [0.34.1] — 2026-06-26

### Fixed

- **`agntux_validate` / `agntux_write_submission` no longer drop the MCP
  connection (`-32000`) on long build-and-render runs.** The validation
  pipeline ran via synchronous `spawnSync` on the server's main thread,
  blocking the event loop for minutes so the server couldn't answer the host's
  `ping` keepalive — Claude Cowork then declared the server dead and closed the
  stdio transport (only the long-running validate-and-render tripped it;
  lightweight tools were unaffected). Two coordinated fixes: validation now runs
  in a child process (`mcp-server/src/validate-worker.js`) so the loop stays
  free, and `ping`/handshake/list methods are dispatched off the request
  serialization chain so they are answered immediately while a validate is in
  flight. The validate handlers also emit `notifications/progress` when the
  client supplies a `progressToken`. The verdict contract is unchanged.

## [0.34.0] — 2026-06-15

### Added

- **Two ERROR-level marketplace lint passes.** E33 (no slash-command host
  prompts — `host_prompt` values, `sendFollowUpMessage` args, and view-tool
  description trigger phrases must be natural-language descriptions) and E34
  (every `## <Name> payload` section a view handler reads must be written by the
  plugin's ingest skill). Both ship with unit tests.

### Changed

- **Authoring guidance now teaches the natural-language host-prompt rule.** The
  `ingest-prompt-author` / `draft-flow-author` agents, the `agntux-core` hub
  contract, and the canonical ingest `sync.md` describe why a programmatic slash
  command is inert, and `sync.md` adds a required per-view payload-section step
  (Step 10.1b). The `sync.md` line budget rises 600 → 610 for the new section.

## [0.33.1] — 2026-06-09

### Changed

- Replaced a contributor's personal name/email with generic placeholders in
  an example registry snippet in the source-semantics-advisor agent doc.

## [0.33.0] — 2026-06-09

### Changed

- **`supported_prompts` now require the slash-command syntax.** The marketplace
  validator no longer accepts the legacy `ux:` / `/ux` prefixes for a listing's
  `supported_prompts[].prompt` — the prompt must be a slash command (`/{slug}`
  or `/{slug}:{skill}`). The plugin scaffold now seeds `/{slug}` by default, and
  the manifest-author guidance documents the slash-command rule.
- Updated the draft-flow and ingest-prompt authoring docs to teach the
  4.0.0+ bare-slash `host_prompt` envelope form instead of the legacy `ux:`
  form (the legacy form is still accepted on disk for backwards compatibility).

## [0.32.1] — 2026-06-09

### Fixed

- **Stage-7 specialist dispatch order — author the view-tool source before
  anything depends on it.** `view-tool-builder` now runs at position 4 (before
  `draft-flow-author` and `tests-author`) and explicitly owns each write
  handler's `view-tool/src/apps/<handler>/lib/build-envelope.ts`. Previously
  `tests-author` (which asserts those builders exist) and `draft-flow-author`
  (which verifies the Send wiring on them) were dispatched **before**
  `view-tool-builder` authored them — producing a round-1 wall of "missing
  build-envelope.ts" test failures plus a redundant second `view-tool-builder`
  pass in real builds. Fixed the order in `references/07-build.md` (numbered
  list, the user-facing status sequence, the `specialists_run` example, and the
  "implicit ordering" note) and aligned the `view-tool-builder` /
  `draft-flow-author` agent prompts (authors-vs-verifies).
- **`README.md` / `CHANGELOG.md` ownership — no longer falls through the
  cracks.** `manifest-author` now authoritatively authors the plugin-root
  `README.md` and `CHANGELOG.md` at build time. Its prompt previously
  contradicted itself — the banner said it authored them while the "what you
  own" block delegated them to `release-checker`, which the stage-7 flow never
  dispatches — so the required `README.md` went unwritten and the build hit a
  lint **E01** ("missing required file"). `release-checker` remains the pre-PR
  shape reviewer only.
- **`useDisplayMode()` display-mode footgun (TS2339).** The scaffold template
  hook now additively returns a `displayMode` alias of `mode`, so a handler that
  reads `useDisplayMode().displayMode` (the name every prop, layout, and
  component uses) no longer fails the `build`/`typecheck` gate. Documented the
  alias in the `view-tool-builder` prompt.

### Changed

- **Fix-loop guidance: don't burn re-validates.** `references/07-build.md` now
  tells the orchestrator never to re-validate an unchanged tree and, once green,
  to skip a fresh full-pipeline validate (including the Chromium render) for
  ingest-skill markdown-only edits — those ride into the single final
  pre-submission validate, which `agntux_write_submission` re-runs fail-closed
  anyway.

## [0.32.0] — 2026-06-08

### Added

- **Enforced: connector writes must go through the host, not a hard-coded tool
  name.** New marketplace lint pass 17 (E32, hard error) flags any view-tool
  component that calls `client.callTool("mcp__…")` with a hard-coded non-`agntux`
  connector tool name. Connector tool names are host-specific (UUID-prefixed in
  local agent mode, `mcp__claude_ai_<Connector>__…` on claude.ai), so a literal
  name throws `Tool not found` at click time (the agntux-google-calendar 2026-06
  Schedule/Send regression). The canonical write-back path —
  `client.sendFollowUpMessage(envelope)`, which lets the host's LLM resolve the
  connector tool — is now documented as the only valid dispatch in
  `connector-envelopes.md` and `draft-flow-author` §2, with an explicit
  anti-pattern callout. Only the plugin's own `mcp__agntux…` action-mutation
  tools may be called directly.

## [0.31.0] — 2026-06-08

### Added

- **Enforced: view-tool links must open through the host.** New marketplace lint
  pass 16 (E31, hard error) flags any view-tool component using `target="_blank"`,
  `window.open(`, or `<a href>` — patterns a sandboxed MCP App iframe silently
  blocks, producing dead buttons (the agntux-google-calendar "Open in Google
  Calendar" regression). The scaffold now ships a shared `ExternalLink`
  component (`view-tool/src/components/external-link.tsx`) that routes clicks
  through `useAppsClient().openLink(url)`, and `ui-handler-author` §1.7 is
  strengthened to require it.
- **Shared "data access" reference for interactive lanes.** New canonical
  `reference/data-access.md` (rendered into every ingest plugin) teaches the
  host what AgntUX is, how to resolve the project root, how to connect the
  folder when the host hasn't mounted it, the on-disk data layout
  (`entities/{subtype}/`, `actions/`, `user.md` — top-level, **not** under
  `data/`), and how to resolve a person to a contact detail. `ask.md` and
  `ingest-prompt-author` now require interactive lanes to run this preflight
  before reading the knowledge store — closing the gap where the host had no
  idea where a user's data lived.

## [0.30.0] — 2026-06-08

### Added

- **User-initiated view lane — first-class authoring pattern.** Promoted the
  inline-args view trigger from "legacy/testing" to a documented, opt-in
  trigger mode for views the user opens conversationally (e.g. "find a time to
  meet") rather than from an action-item button:
  - `draft-flow-author` §2b is reframed as a **trigger-mode decision**
    (action-item-triggered vs user-initiated), with one shared resolution rule
    (inline → on-disk → empty) and per-mode `inputSchema`/description guidance.
  - `ui-handler-author` §3 gains a trigger-mode authoring rule plus the
    dual-trigger handler skeleton; user-initiated views use optional
    `action_id` + typed inline params and a trigger-intent-forward description.
  - The canonical ingest skill router gains three additive, default-off
    append markers (`sub-commands`, `argument-parsing`, `ask-intent-redirect`)
    so a plugin can add a user-initiated lane with **zero impact** on
    read-only plugins, plus an optional `extra-skill-triggers` description
    placeholder. Documented in `canonical/prompts/ingest/STUBS.md`.
  - The view-tool template ships a commented opt-in block showing the
    dual-trigger `Args` + resolution + loosened `inputSchema`.
  - Worked example: agntux-google-calendar 0.2.0's schedule view.

## [0.29.0] — 2026-06-03

### Changed

- **Generated marketplace copy is now plain-language by default.** Added a
  "Voice & audience" rule to the `manifest-author` agent (lead with the
  benefit, keep it short, avoid jargon like "ingest" / "cursor" / "MCP" /
  "knowledge store" / "$ARGUMENTS") with ✓/✗ examples, and replaced the
  scaffold's `listing.yaml` placeholder tagline/description with concise,
  jargon-free examples. New plugins now start from non-technical copy instead
  of "Ingests X into the AgntUX knowledge store."
- **Plain-language listing and README for agntux-build itself.** Dropped
  "connector", "write-back UI", "headed preview", "sync iteration", "design
  tokens", and "knowledge workers" in favour of everyday words.

## [0.28.0] — 2026-06-02

Fixes the **stale marketplace existence-check** that let stage 1 offer to build a
duplicate of a plugin that already shipped. The check fetched
`raw.githubusercontent.com/.../marketplace/index.json` via host `WebFetch` —
GitHub's CDN served **2-week-old** edge-cached content, so a freshly-landed
plugin looked absent and the build proceeded from scratch (the worst outcome the
stage exists to prevent).

### Added

- **`agntux_marketplace_lookup` MCP tool** — the new stage-1 anti-duplicate gate.
  Runs natively in the server (the same context as `agntux_validate`) and reads
  the index **past the CDN**: the GitHub **Contents API with the raw media type**
  returns the file at its current commit (api.github.com is not the raw CDN, and
  the raw media type needs no base64 decode), with a cache-busted raw URL, a
  local dev clone, and a previously-cached copy as ordered fallbacks. Matches
  server-side and returns **only** the matched entries + a bounded slug list, so
  the full index never floods the model context (21 KB today, megabytes at
  scale). A fetch failure returns `ok:false` (UNKNOWN) — never a false "nothing
  exists". Backed by `matchMarketplace` / `canonicalPluginSlug` unit tests
  (`mcp-server/__tests__/marketplace-lookup.test.mjs`).

### Changed

- **Stage 1 (`skills/build/references/01-search-marketplace.md`)** now calls
  `agntux_marketplace_lookup` instead of `WebFetch`-ing the raw URL, branches on
  the structured result (`exact_match` / `keyword_matches` / `slugs`), and adds a
  **branch 0** for `ok:false`: when the marketplace can't be verified, tell the
  user and confirm before building rather than assuming the plugin is new.

## [0.27.0] — 2026-06-02

Closes the three round-1 round-eaters that **still recurred on the otherwise-
successful 0.26.0 google-calendar build** (it queued cleanly in 2 validate
rounds, but round 1 burned on three authoring defects the gate had to re-catch).
Each is pushed down to the **scaffold floor / canonical template / static check /
lint predicate** so round 1 starts clean, instead of relying on prose steers that
keep failing to take. Post-mortem source: session `b07d4b09`.

### Fixed

- **TS2322/TS2677 `(T|null)[]` → `CandidateSlot[]` recurred despite the 0.26.0
  prose rule.** The view-tool-builder authored `label: safeString(obj.label) ||
  undefined`, giving the key a *required* `string | undefined` value. With an
  **inferred** `.map()` return (no `(x): T | null` annotation) that required key
  made the element incompatible with the optional `label?: string` — the
  `(elem|null)[]` → `CandidateSlot[]` assignment failed TS2322 and the
  `.filter((x): x is T)` predicate failed TS2677. Now fixed deterministically:
  (1) the canonical view-tool template (`canonical/ui-handlers/_template/
  view-tool/src/components/main-component.tsx`) ships a **copyable list-builder
  idiom** (map to `(T|null)`, build required keys directly, assign optional keys
  conditionally, narrow with a type predicate, *then* assign); (2)
  `check-view-tool-imports.mjs` gains a **`key: accessor(...) || undefined` ban**
  that fails fast and legibly BEFORE the slow vite build. The check is anchored
  on a call-expression value, so a legitimate plain-variable coercion
  (`description: description || undefined`, the JSX attr `min={x || undefined}`)
  is never flagged.
- **E05 `developer.github_handle: Required` + disallowed `developer.email`.** The
  scaffold already emits a lint-clean `listing.yaml` floor, but manifest-author
  **overwrote** it from scratch — re-adding `email` (not an allowed `developer`
  key) and dropping the required `github_handle`. `manifest-author.md` now has an
  **edit-the-floor rule**: `Edit` the scaffold `listing.yaml` additively, preserve
  the `developer:`/`support:` blocks verbatim, and never put `email` in
  `developer` (it lives in top-level `support:`).
- **Phantom-contract tests evaded E30 by grepping a DIFFERENT prose file.** The
  pass-15 / E30 predicate only matched `_overrides/**.md` + `*-append.md`, so —
  once steered off those — the tests-author just `.toContain`-grepped
  `_overrides/frontmatter.yaml` (`.yaml`, in cold-start) and
  `data/instructions/<slug>.md` (in draft-flow). The predicate now **also catches
  `_overrides/**.{yaml,yml}` and `data/instructions/**.md`** reads paired with
  `.toContain` (still warning-only in repo CI; still blocking inside
  `agntux_validate`). `tests-author.md` documents both newly-closed evasion paths
  and points authors at the grounded technique — parse `listing.yaml`'s
  `proposed_schema` (as agntux-slack/agntux-gmail `cold-start.test.ts` do) or
  assert handler `outputSchema`/`structuredContent`. Structured config
  reads (`plugin.json`, `marketplace/listing.yaml`) and rendered-tree / canonical
  reads stay legal.

### Note

- Surfaced a **submission-pipeline divergence** (tracked separately in
  plugin-submission-handler): the committed `agntux-google-calendar` carries the
  *pre-fix* phantom-contract tests while its view-tool source is post-fix — i.e.
  the bytes on `main` do not match the validated submission `tree_sha256`
  (`55dbcc32`). Root fix (recompute `tree_sha256` from reconstructed files at
  intake; reject mismatches) belongs to the submission-handler, not this plugin.

## [0.26.0] — 2026-06-01

Cuts the two recurring round-eaters that still cost ~5 `agntux_validate` rounds on
the (otherwise successful) 0.25.0 google-calendar build — fixed at the **template
and gate** so they can't recur per-plugin, plus two smaller DX wins.

### Fixed

- **View-tool render 500 on empty render-harness args (cost ~3 rounds + an
  orchestrator hand-patch).** The headless render check invokes every view with
  empty args `{}`, so `action_id` arrived `undefined`, the handler read
  `actions/undefined.md`, and an error that was not a not-found `ViewToolFsError`
  (it can cross the harness boundary as a plain `Error`) re-threw → `tool-call
  HTTP 500`. The scaffold **template** (`canonical/ui-handlers/_template/view-tool/
  src/__ui-name__-view.ts`) now guards the id up front and uses a catch-ALL that
  never rethrows — a view always renders placeholders, never 500s — mirroring the
  shipped agntux-gmail / agntux-slack handlers. `view-tool-builder` gains a
  "render-harness contract" rule (empty-args + catch-all + the `(T|null)[]→T[]`
  TS2322 narrowing), and the template's `payload-shape.test.ts` adds two
  render-harness regression tests (empty `{}` args; a non-`ViewToolFsError` throw)
  that lock the fix.
- **Brittle phantom-contract test churn (3 validate rounds of "re-align
  assertions").** Generated `cold-start`/`idempotent` tests grepped another
  author's override prose (`_overrides/reference/fetch.md`, `step-11-append.md`)
  with `.toContain(...)`. The pass-15 / E30 guard MISSED `*-append.md` (it only
  matched `/reference/` paths) **and** was warning-only, so it never blocked. E30's
  predicate now also catches `_overrides/**.md` and `*-append.md` reads (excluding
  the allowed `canonical/` anchor and rendered-tree reads), and `agntux_validate`
  now treats **E30 as blocking** (repo CI stays warning) via a new
  `BLOCKING_WARNING_CODES` set — a phantom-contract test fails the lint stage
  *before* vitest runs, so it's fixed once instead of churning.

### Changed (DX)

- **Render HTTP-500 body hoisted into the structured error.** When a view's
  tool-call handler 500s, the actionable response body (e.g. `not-found:
  actions/undefined.md`) was buried in `stdout_tail` while `error_message` showed
  only a generic "Failed to load resource … 500". A new `parseToolError` helper
  lifts the `{"error":"…"}` body into `error_message` so the specialist sees *what*
  500'd.
- **`ingest-prompt-author` told which appends feed `reference/sync.md`.** Every
  `step-*`/`bounded-lists`/`out-of-scope`/`tool-surface` append splices into
  `sync.md` (only `honesty-append.md` does not), so their combined length counts
  against the 600-line cap — sum them and keep under ~120 to avoid the "trim
  sync.md" round.

## [0.25.0] — 2026-06-01

Fixes the defects behind the **7-round** google-calendar build on 0.24.0. The
build succeeded — but only because the agent silenced a real type error with
`@ts-expect-error`, which then shipped in the submission. Every extra round was a
tooling or authoring-steer gap, not real work. This release fixes the root causes
and adds backstops so each failure class fails fast and legibly (or can't recur).

### Fixed

- **TS2786 `'ComponentErrorBoundary' cannot be used as a JSX component` (cost 3
  rounds; recurred in all 3 build sessions).** The scaffolded view-tool's vendored
  `@agntux/ui-primitives` is symlinked OUTSIDE the plugin dir, so its
  `import { Component } from "react"` resolved a different physical `@types/react`
  than the handler's `App.tsx` — divergent `React.Component` identity. Added
  `preserveSymlinks: true` to the canonical view-tool `tsconfig.json` so every
  `react` import resolves the single hoisted copy under the plugin root. Confirmed
  end-to-end against the real failing tree: full build green, **no suppression**.
- **`extractSection(body, "## …")` double-`##` bug (cost 3 rounds — failing tests
  AND a headless-render 500).** `extractSection` prepends `^##\s+` internally, so
  the `## `-prefixed call always returned `""` and the downstream `JSON.parse("")`
  threw. `check-view-tool-imports` now fails the build fast on a prefixed call, and
  `view-tool-builder` documents the bare-header contract.
- **First-validate lint E05 from `connector_slug: google_calendar`.** Underscores
  fail the kebab regex; `manifest-author` now documents the
  `^[a-z][a-z0-9-]*[a-z0-9]$` rule (Google Calendar is `google-calendar`).
- **Scaffold now emits `LICENSE` (verbatim Apache-2.0) + a plugin-scoped
  `NOTICE`.** Previously an agent hand-authored the full Apache text, which tripped
  a content-filter block twice and interrupted the build. `manifest-author` is now
  told never to author license text.

### Added (backstops)

- **`check-view-tool-imports` bans `@ts-expect-error` / `@ts-ignore` /
  `@ts-nocheck` in view-tool source** (comment-anchored, so prose mentions are not
  flagged). The band-aid that shipped the suppressed TS2786 in 0.24.0 can no longer
  reach the bundle.
- **`tests-author` must diagnose the handler before mutating an assertion.** In the
  calendar build it edited assertions first, masking the real extractSection bug for
  a round; a new rule-0 makes "run the handler, inspect `structuredContent`, fix the
  source" mandatory before any assertion edit.

### Note

- Pairs with **agntux-core 10.2.1**, whose `validate-write-lane` hook now exempts
  `<root>/.agntux-build/builds/**` — without it the 0.24.0 build had every build-tree
  edit rejected because a source ingest lock was fresh, forcing it through bash/sed.

## [0.24.0] — 2026-06-01

Removes the four fixable defects behind the 5-round google-calendar build on
0.23.0. The build succeeded; every extra round was a tooling/authoring-steer gap,
not real work. Decision (from the build's post-mortem): **harden the deterministic
`agntux_validate` gate as the single source of truth** — batch all failures,
embed caps/enums in the scaffold floor, and stop depending on specialist prose
adherence.

### Added

- **The tests stage now batches EVERY failing assertion into one verdict.**
  `agntux_validate` runs the plugin-root and view-tool vitest with
  `--reporter=json` and parses all failures into a `stage_results[].errors[].test_findings[]`
  punch-list (`{failed_file, test, error_message, routing}`), instead of
  surfacing only the first failing assertion per round. This was the dominant
  cause of the churn: rounds 2–4 each revealed exactly one more `toContain`
  mismatch because several self-authored tests grepped the *same* prose file.
  File-level crashes (transform/import/syntax errors with no assertion detail)
  are surfaced from the vitest file `message` so a config crash still routes with
  a real diagnostic. The orchestrator (`07-build.md`) now fixes the whole tests
  punch-list in one pass.
- **Grounded-tests guard (marketplace lint pass 15, E30, warning).** Flags a
  plugin test that both reads a `reference/`-dir `.md` file AND calls
  `.toContain(...)` — the brittle "phantom-contract" pattern that greps another
  author's per-plugin prose for an invented string. Routed to `tests-author`;
  the fix is to assert handler output / a parsed `plugin.json`/`listing.yaml`
  field / a canonical `sync.md` anchor instead. `tests-author.md` gained a
  matching mechanical rule.
- **`@types/js-yaml` in the scaffolded view-tool floor.** A descriptor that does
  `import yaml from "js-yaml"` (like `agntux-slack`) no longer fails the build
  with TS7016 — the floor now ships the types alongside the existing `js-yaml`
  devDep, mirroring the proven `agntux-slack` setup.
- **`scheduling` and `calendar` marketplace categories.** A Google Calendar
  plugin's natural category no longer fails lint E04 (closed-enum). Additive
  enum change (P7 MINOR); `manifest-author.md` and the scaffold floor list them.
- **Field caps documented inline in the scaffold floor `listing.yaml`.** A header
  block + per-field `# ≤N chars` comments (tagline 80, description 500, purpose
  200, action_classes description 200, cursor_semantics 200, source_id_format
  120) so whoever overwrites the floor sees the cap at the point of editing.

### Changed

- **Authoring-path rule reconciled (`07-build.md`).** The load-bearing rule
  stands — the deterministic toolchain (scaffold / render-skill / build / lint /
  typecheck / tests / validate) runs ONLY via the MCP tools, never via Bash. The
  one new clarification: if the orchestrator authors *content* via Bash, it must
  target the Cowork **mount** path (`/sessions/<name>/mnt/agntux/…`), never the
  native host `/Users/…/agntux/…` path (Bash EPERMs there and silently escapes to
  `/tmp`, leaving an incomplete tree). The seven specialists still only
  `Write`/`Edit`.
- **`manifest-author` stays inside the build dir.** It must not glob or write
  outside the handed `plugin_dir` — in particular the runtime agntux project
  root's `plugins/` is the user's private knowledge store, not a plugin clone —
  and it must author the files it owns rather than returning a prose to-do list.

### Fixed

- **E29 (view-tool response-envelope) now routes to `view-tool-builder`.** It was
  falling through to `manifest-author`; the response-envelope defect is a
  view-tool concern.

## [0.23.0] — 2026-06-01

Cuts the validate round-count a real google-calendar build still burned on
0.22.0 (2 scaffold attempts + **5** `agntux_validate` rounds — every extra
round a fixable tooling defect, not authoring work). The build succeeded; this
removes the friction so the next one needs far fewer rounds.

### Added

- **`agntux_scaffold` creates the build-sandbox plugin dir.** A missing
  `plugin_dir` is no longer a `"plugin dir not found"` usage error — the tool
  `mkdir`s it (with parents). Removes the Bash `mkdir` detour the model was
  forced into, and the misleading `"scaffold failed in the build stage: compile
  error"` envelope that detour produced.
- **`agntux_scaffold` generates a self-contained view-tool `vitest.config.ts` +
  `src/__tests__/setup.ts`** (jsdom; jest-dom + React cleanup). Previously the
  floor shipped neither, so `vitest run` in `view-tool/` fell through to
  `vite.config.ts` and threw `set VITE_ENTRY to the view name` — a whole
  remediation round. The generated config never reads `VITE_ENTRY` and pulls in
  no template-only widget matchers.
- **Lint-stage feedback is now per-finding and multi-owner.** `agntux_validate`
  consumes the marketplace linter's `--json` output and surfaces a structured
  `lint_findings[]` (`{code, file, message, routing}`) plus the distinct
  `routings[]` set — the same rich `failed_file`/`message` the build stage
  already gave, instead of a bare `codes: E05,E15` string. Each code routes to
  its owning specialist, so a mixed E05 (listing) + E15 (render-drift) failure
  dispatches **both** `manifest-author` and `ingest-prompt-author` in ONE pass
  (E15 no longer "wins" and silently strands the E05 owner).

### Changed

- **Error envelopes honor `error_kind`.** `usage` and `internal` verdicts get
  their own summary/next_action — a usage error names the bad call ("fix the
  arguments, don't re-dispatch a specialist"); an internal error routes to
  `agntux_report_defect`. Neither is mislabeled "failed in the build stage:
  compile error" anymore.
- **Authoring-prompt hardening.** `view-tool-builder.md` gains a "String
  literals in JSX" section (the unescaped-nested-quote esbuild parse error that
  killed a build on one character) and a note that `ComponentErrorBoundary` must
  be imported as a **value** (an `import type` is also TS2786);
  `ui-handler-author.md` cross-references the quoting rule; `tests-author.md`
  hardens the `idempotent.test.ts` cursor assertion to the **generic** advance
  mechanism, not the source-specific cursor-field prose that drifted twice.
- **`check-view-tool-imports.mjs` also bans a type-only import of
  `ComponentErrorBoundary`** (the TS2786 cause the `as`-cast regex missed),
  failing fast and routed to `view-tool-builder` before vite/tsc.
- **`ux_components` → `ui_components`** doc/text cleanup: the repo semver rubric
  (`CLAUDE.md`) and the scaffolded `emit-manifest.mjs` error message now name the
  canonical on-disk key (the linter rejects `ux_components` with E05); the
  tolerant read-fallback stays.

## [0.22.0] — 2026-05-31

Closes the residual fix-loop a real google-calendar build still burned on
0.21.0 — it passed validation only on the **4th** `agntux_validate` (three
failed rounds + ~7 fix-up specialists). Every defect traced to a specialist
authoring deterministic build-config or asserting ungrounded strings.

### Added

- **`agntux_scaffold` pre-places the build-critical view-tool floor**
  (`view_tool: true`). When the plugin ships ≥1 UI handler, the native scaffold
  copies the deterministic view-tool skeleton — `package.json` with the
  `@agntux/ui-primitives` + `@agntux/plugin-runtime` workspace deps already
  wired (correct `file:../../packages/…` for the build-session layout) and a
  handler-agnostic build script that loops over `*.html`; a VITE_ENTRY-driven
  `vite.config.ts`; `tsconfig.json`, `tailwind.config.mjs`,
  `scripts/emit-manifest.mjs`, `src/globals.css`, `src/vite-env.d.ts`; and the
  byte-frozen `src/lib/apps-client/**` + `src/lib/apps-react/**`. This makes the
  "Rollup failed to resolve `@agntux/ui-primitives`" build failure and the
  apps-client byte-drift (lint E26) **impossible to recur** — they are no longer
  LLM-authored. `view-tool-builder` now authors only the per-handler UI.
  (`toolchain-layout.mjs` gains `viewToolTemplateDir`;
  `scaffold-marketplace-assets.mjs` gains `--view-tool`.)
- **Renderer pre-warm at scaffold time.** `agntux_scaffold` kicks the detached
  Chromium install at stage-7 start, so it is ready by the first
  `agntux_validate` — the render gate runs on round 1 instead of forcing a
  second "installing" round.

### Changed

- **Authoring prompts reconciled to the marketplace lint schema.**
  `manifest-author.md`: the listing UI key is `ui_components` (not
  `ux_components` → E05); the entry schema is `.strict()` so `verb_phrases` (and
  any other key) is rejected — removed from the allowed-key list; added a
  concrete ≤120-char `source_id_format` example with a "count the chars"
  reminder. Purged the misleading "linter accepts both spellings" claim and
  every other `ux_components` reference across `view-tool-builder.md`,
  `ui-handler-author.md`, `release-checker.md`, and the canonical UI
  disciplines.
- **`view-tool-builder.md`**: build config + apps-client are now documented as
  pre-placed, read-only infrastructure (removed the contradictory "vendor the
  apps-client yourself / but don't" block); added the `ActionFrontmatter`
  cast-through-`unknown` guidance (the TS2352 that broke build round 2).
- **`tests-author.md`**: the golden rule is now backed by mechanical,
  un-violatable rules — read-then-copy-literal (`toContain` over regex),
  assert-only-what-this-plugin-contains, multiline/ASCII regex discipline, the
  placeholder-survival check targets the **rendered** skill tree (never the
  `_overrides` source, the `{{key}}`-in-a-comment false positive), and listing
  fields are checked via parsed YAML. Stage 7 no longer seeds the specialist a
  fixed list of phrases to assert.

## [0.21.0] — 2026-05-31

Makes the build's fix-loop converge by closing the gaps that made the model
guess. A real google-calendar build on 0.20.0 still burned ~5 failed validate
rounds: the render gate reported only a console-error *count* (not the message),
so the model guessed the cause and a wrong guess (a `ComponentErrorBoundary`
cast) broke a stage that had been passing; and a `payload-shape` test asserted
prose a different agent never wrote. This release surfaces the real render
error, gates the recurring hand-authoring defects mechanically, and stops tests
from coupling to another agent's prose.

### Added
- **Render console-error TEXT in the validate verdict.** The headless renderer
  always captured each console error's message + location, but the test-harness
  collapsed it to a count and `validate-plugin` only matched `consoleErrors=N` —
  so the render stage said "rendered with N console error(s)" with an empty
  `stderr_tail` and the model had to GUESS what broke. The harness now prints
  each error (`  console error: <text>  @ <url>:<line>:<col>`), a new
  `parseConsoleErrors` lifts it into the render stage's `error_message` +
  `console_errors[]` (the same actionable fields build/typecheck errors use), and
  `buildStageResults` passes `console_errors` through the punch-list envelope.
- **Mechanical view-tool construct gate** (`check-view-tool-imports.mjs`, run
  before vite). Fails the build fast + routed to `view-tool-builder` on a
  `ComponentErrorBoundary as …` cast (it is a valid component; the cast IS the
  TS2786 error) or a `<ScrollablePanel>` prop outside the primitive's real prop
  set (e.g. a hallucinated `pluginSlug` → TS2322). The `ScrollablePanel` allow
  set is read from the bundled ui-primitives `.d.ts` (machine-readable truth)
  unioned with a canonical floor; tags carrying a `{...spread}` are skipped.
  Complements the existing duplicate-`@types/react` guard (the *other* TS2786
  source).

### Changed
- **`tests-author` derives assertions; never asserts another agent's prose.** A
  binding rule + a 3-source-of-truth taxonomy (handler output → declared schema →
  canonical stable anchor) replaces the per-build "loosen the regex" workaround
  for `payload-shape`/`idempotent` tests that grepped `fetch.md`/`sync.md` wording
  the ingest author never wrote. The canonical `payload-shape.test.ts` guidance
  now states the same: derive `KEPT_KEYS` from `viewTool.handle()`, never from
  prose.
- **`view-tool-builder` carries the parse-helper contract.** `parseFrontmatter`
  returns `{ frontmatter, body }`; `parseActionFile` returns `ParsedAction`
  (no `.body`) — the TS2339 `'body' does not exist on type 'ParsedAction'` defect
  is now called out explicitly, pointing at the correct canonical clone.

## [0.20.0] — 2026-05-31

Unblocks the headless render gate and collapses the build's fix-loop. The
render stage could never complete because the bundled renderer (and the
build-session view-tool) couldn't resolve `@agntux/plugin-runtime` / `yaml` with
no install; this release ships a self-contained runtime so render runs
end-to-end, and makes validation report the whole punch-list at once so a build
converges in ~2–3 rounds instead of one-error-at-a-time.

### Added
- **Self-contained `@agntux/plugin-runtime`.** `yaml` + `zod` (both
  zero-dependency) are now vendored into the runtime's `node_modules` in two
  places: `canonical/packages/plugin-runtime/` (so the build-session view-tool's
  `emit-manifest` resolves `yaml`) and `host-renderer/vendor/plugin-runtime/` (so
  the renderer resolves the runtime by explicit path). The host-renderer's
  `mcp-bridge` now falls back to the vendored copy on `ERR_MODULE_NOT_FOUND`.
  Resolves the Test-#4 render blocker (`Cannot find package '@agntux/plugin-runtime'`
  / `'yaml'`).
- **`stage_results[]` punch-list in the validate verdict.** The
  build-independent stages (lint, plugin-root tests, structural validate) now run
  even when the build fails, so one `agntux_validate` call reports every failing
  stage at once. The legacy `failed_stage`/`routing` fields still name the
  highest-priority failure (back-compat); the build-dependent stages (typecheck,
  view-tool tests, render) are gated and reported `skipped` with
  `reason:"build_failed"` until the build is green.
- **`agntux_build_version` on every validate verdict** — answers "is the served
  bundle current?" mid-build instead of after a fixed bug reappears from a stale
  installed zip.
- **Optional `data_paths` on `ViewToolDescriptor`** (`@agntux/plugin-runtime`) so
  a plugin whose action files don't match the default `actions/{id}.md` glob can
  declare its real read/write scope on the descriptor (additive, MINOR).
- **Render bootstrap resilience** — the Chromium download now retries (3 attempts
  with incremental backoff), skips work already done on retry, honors a
  pre-seeded `chromium-headless-shell` (restricted-network escape hatch,
  documented in `host-renderer/README.md`), and reports a plain-language
  "harness setup, not your plugin" message (render stays soft / non-blocking) on
  a persistent download failure.
- **Scaffold floors for `CHANGELOG.md` + `listing.yaml`** — the scaffolder now
  emits lint-clean placeholder floors (caps-respecting, no `screenshot_order`,
  valid `proposed_schema`) so the manifest specialist edits a green skeleton
  instead of authoring from memory.

### Changed
- **Package-time gate.** `package-plugins` now refuses to zip `agntux-build`
  unless `sync --check` and the marketplace lint both pass — a drifted/stale zip
  can no longer be produced or uploaded silently.
- **E03 (CHANGELOG date separator)** accepts a hyphen, en-dash, or em-dash.
- **`reference/sync.md` line cap raised to 600** (other reference siblings keep
  500) so a real plugin's source-specific splices fit above the ~469-line
  canonical body.
- View-tool template build runs `tsc --noEmit` first, so a TypeScript error fails
  in ~2s before vite/esbuild/emit-manifest.
- Specialist prompts hardened: `view-tool-builder` clones the canonical template
  and carries exact `ScrollablePanel`/`ComponentErrorBoundary` signatures (no
  invented props/casts); `tests-author` derives source-specific dedup assertions
  from the authored tree instead of inventing field names.

### Fixed
- Render-reproducibility lint no longer false-positives on `{{…}}` placeholder
  syntax mentioned inside a `#` comment / heading line.
- The canonical `payload-shape` test mock throws the real `ViewToolFsError`
  (not a plain `Error`), so a handler's `not-found` fallback branch is actually
  exercised.
- A spawn failure (missing `node`/`npm`/`claude` on PATH) is now classified
  `environment` (non-blocking) instead of a mis-routed plugin defect.
- Symlink-/space-safe is-main guards in `build-plugin.mjs` and
  `check-view-tool-imports.mjs` (realpath both sides), matching the validator.

## [0.19.0] — 2026-05-30

Robust tool feedback: every agntux-build MCP tool now returns rich, actionable error messaging instead of a bare exit code, so a failed build tells the model (and you) exactly what broke and where — ending the blind multi-cycle fix loops.

### Added
- **Captured compiler/linter/test errors in the validation verdict.** All six validate stages (build, lint, typecheck, tests, validate, render) capture child output and surface `stderr_tail`, the parsed `failed_file` / `failed_line` / `error_code`, plus a plain-English `summary` and `next_action`. Full per-stage logs are persisted to `{session}/.validate/` and pointed at by `log_path`.
- **Honest failure classification.** `error_kind` (plugin | environment | usage | internal) and `blocking` are derived from the actual output, so an environment limit is no longer mislabeled a fixable plugin defect.
- **`agntux_report_defect` tool** — bundles a failed session (verdict + logs + tree manifest) into `{session}/DEFECT.json` for the maintainer; the honest-stop action when a failure is non-fixable or the fix loop is exhausted.
- A uniform `summary` on every tool result (scaffold / validate / write_submission / confirm / report_defect).

### Changed
- The build skill + specialists consume the captured error: a plugin failure re-dispatches the owning specialist with the real `failed_file` / `failed_line` / `log_path`; an environment or internal failure stops early and reports a defect instead of burning the fix-cycle budget.
- Validation stage output is teed to stderr, never the MCP server's JSON-RPC stdout, hardening the protocol channel.
- `parseFirstError` is a linear, line-based scan (no cross-line backtracking, with a size backstop) — a large or pathological build log cannot block the event loop (ReDoS-safe).

### Fixed
- `agntux_validate` previously returned only `build-plugin.mjs exited 1` with no stderr, file, or line — the cause of multi-cycle blind fix loops.
- `agntux_confirm_submission` success (`queued:true`) is summarized as success, not a build failure (the summary synthesizer normalizes the tool name and branches on `queued`).

## [0.18.0] — 2026-05-30

Zero-user-Node runtime: agntux-build now runs on a Mac with **no `node`/`npm`
installed**, by re-using the AgntUX desktop app's Electron-as-Node runtime + its
bundled npm. Claude Desktop runs the plugin's MCP server as a host process and
provides no Node, so `command: "node"` failed with "tools unavailable" — this
closes that gap.

### Added
- **`bin/agntux-node.sh` launcher** (shared single source —
  `canonical/bin/agntux-node.sh`, synced into the bundle by
  `sync-agntux-build-toolchain.mjs`). Resolves the desktop app's runtime from
  the marker at `~/Library/Application Support/AgntUX/electron-runtime.json` (or
  an app-bundle probe), and falls back to a system `node` for developers.
- **MCP-server runtime shim** — at startup the server builds a temp
  `node`/`npm`/`npx` PATH shim over the resolved Electron + bundled npm and
  prepends it to `PATH`, so the whole build (`npm install` → vite/tsc/vitest;
  `npx playwright install`) resolves it with no per-call env threading. A clean
  no-op (system node/npm) on a dev/CI machine.
- CI now runs the test suite + the agntux-build toolchain drift `--check`
  (`.github/workflows/test.yml`), enforcing the launcher single-source chain.

### Changed
- **`.mcp.json`** launches the server via `sh bin/agntux-node.sh
  mcp-server/dist/index.js` (was `command: "node"`). The launcher is invoked
  through `sh`, so it needs no exec bit — which does not survive Claude
  Desktop's zip→unzip.

### Security
- The runtime marker is untrusted input (user-writable dir). Both the launcher
  and the server bind the executed runtime to the genuine AgntUX **codesign
  identity** (Developer ID Team ID `K6B5DNTSS7` + bundle id `ai.agntux.teams`)
  before exec — never a forgeable path shape — and constrain the bundled npm to
  live inside that codesign-verified bundle.

macOS-only; Windows/Linux discovery is an explicit follow-up.

## [0.17.0] — 2026-05-30

P3 of the in-MCP-server build architecture: every deterministic build step now
runs natively inside the agntux-build MCP server, and the build specialists can
no longer route around it through the restricted Bash sandbox (the
EPERM-then-`/tmp`-escape that produced incomplete trees and failed submissions).

### Added
- **`agntux_scaffold` MCP tool** — runs `scaffold-marketplace-assets.mjs`
  natively (host-path-writable) to lay the marketplace-asset floor (icon,
  `_overrides/frontmatter.yaml` render floor, `marketplace/README.md`, plugin-root
  `package.json` + `vitest.config.ts`) at the start of stage 7, before the
  specialists author. Idempotent; never overwrites a specialist's real output.
  Stage 7 (`07-build.md` Hard pre-flight B) now calls it instead of running the
  scaffold script via Bash.

### Changed
- **The seven build specialists author only — no Bash.** Their tool grant drops
  `Bash` and adds `Write` + `Glob` (`Read, Edit, Write, Grep, Glob`), so it is
  structurally impossible for them to run scaffold / render-skill / the view-tool
  build / lint / typecheck / tests / validate themselves. Those deterministic
  steps all run natively inside `agntux_validate` (render-skill and the view-tool
  build already run there via the build step, before lint pass-8). `07-build.md`,
  `self-validation.md`, and `12-submit.md` are rewritten to match: the
  orchestrator calls `agntux_scaffold`, then loops `agntux_validate`; specialists
  fix their `_overrides/` / `src` inputs on a `failed_stage`.

### Fixed
- **Two more fragile main-module guards** (same class as 0.16.2's launch-guard
  fix): `scripts/validate-plugin.mjs` and `scripts/render-skill.mjs` compared a
  raw `process.argv[1]` against `import.meta.url` / `__filename`, which never
  matches under a symlinked or spaced path (Cowork). Both now resolve **both
  sides** via `realpathSync`, so the CLI entry points fire correctly while
  importing the modules (MCP server, build-plugin, tests) stays side-effect-free.

### Docs
- CLAUDE.md documents the `sync:agntux-build-toolchain` vendoring (repo-root
  source of truth → tracked bundle copies) and the MCP server's separate
  `build.js` dist step.

## [0.16.3] — 2026-05-30

A registration-hardening follow-up to 0.16.2: when the build tools aren't
reachable, the build flow now fails fast with a self-fix instruction instead
of treating it as an unfixable defect, and it checks far earlier so the user
never invests an hour of design only to hit a wall at build time.

### Changed
- **The build flow confirms the `agntux-build` MCP tools are callable before it
  invests the user's time** — as soon as the flow commits to building or fixing
  a plugin (entering stage 3 "connect the source", update mode, or the `:revise`
  path), not only at stage 7. Searching the marketplace and installing an
  existing plugin still work without the build server, so those paths aren't
  blocked. Stage 7's "Hard pre-flight A" remains as a final backstop.
- **"Can't reach the build tools" now tells the user how to fix it.** The most
  common cause is the AgntUX desktop app not having (re)spawned the build server
  after an install/update; the flow now says "quit and reopen the AgntUX desktop
  app, then re-run `/agntux-build:build`" and stops — instead of logging a
  maintainer defect with the generic "hit a snag" copy. The defect path is kept
  only for the case where a full restart doesn't help.

### Docs
- README documents the quit-and-reopen-after-install/update requirement.

## [0.16.2] — 2026-05-29

Two packaging/registration fixes that prevented the in-Cowork build from
working — the MCP server now actually registers, and the scaffold's canonical
templates ship.

### Fixed
- **MCP server now registers when launched by the host (the real reason a Desktop
  restart didn't surface the tools).** The launch guard compared
  `import.meta.url === pathToFileURL(process.argv[1]).href`; Node realpath-resolves
  `import.meta.url` (symlinks followed — the Cowork plugin dir is a symlink, and
  `/tmp`→`/private/tmp` on macOS) while `argv[1]` is the raw invocation path, so the
  two never matched under a symlink/spaced path and `startServer()` was never called
  — a silent, restart-proof failure. Now resolves both sides via `realpathSync`
  before comparing (`mcp-server/src/index.js`). Verified: the three tools register
  when spawned from a symlinked, space-containing path.
- **Canonical scaffold templates are no longer stripped from the shipped zip.** The
  `scripts/package-plugins.mjs` excludes (`*/_overrides/*`, `tsconfig*`, `vite.config`,
  `vitest.config`, `__tests__`) also matched the view-tool template under
  `canonical/` — so a scaffolded plugin shipped with no `frontmatter.template.yaml`,
  no view-tool `tsconfig.json`/`vite.config.ts`/`vitest.config.ts`, and no template
  `__tests__`, breaking the in-Cowork scaffold + view-tool build. The `_overrides`
  exclude is now anchored to `skills/*/_overrides/*`, and `canonical/` is re-added in
  full after the exclude pass so "canonical ships complete" is an invariant.

## [0.16.1] — 2026-05-29

Ship `chromium-headless-shell` for the render gate — the size optimization
deferred in 0.16.0 — now that it's verified end-to-end.

### Changed
- The render gate installs **`chromium-headless-shell`** (~190 MB incl ffmpeg)
  instead of full `chromium` (~533 MB incl ffmpeg). Verified in a clean-room: a
  shell-only browser dir renders the gmail view-tool with `consoleErrors=0`. No
  launch-channel change is needed — a plain `chromium.launch({ headless: true })`
  resolves to the shell when it's the only binary installed
  (`mcp-server/bootstrap-worker.js` + the `bin/validate-plugin.mjs` render gate).

### Fixed
- **`probe-chromium` is now a FUNCTIONAL probe** — a real headless launch +
  blank-page render — instead of stat-ing `chromium.executablePath()`. The old
  probe pointed at the FULL chromium path and returned a false negative when
  only the headless shell was installed, which would have made the render gate
  silently skip a renderable plugin. The functional probe reports exactly what
  render can do (proven: shell-only dir → `installed:true`).

## [0.16.0] — 2026-05-29

Move the build/validate/render/submit pipeline behind an **MCP server's atomic
tools** so it runs in the host-spawned server's native context (full filesystem,
real Chromium) instead of the model's restricted Bash sandbox — the root cause of
three prior submissions that were "submitted" but never registered. The build
skill now only ORCHESTRATES by calling tools it cannot partial-run, emulate, or
fabricate around. Also fixes the two toolchain bugs (L1/L2) that made an
otherwise-correct plugin unbuildable.

### Added
- **MCP server (`mcp-server/`)** — a zero-dependency stdio JSON-RPC 2.0 server
  (no `@modelcontextprotocol/sdk`; modelled on the proven `cowork-env-probe`
  reference the plan points at) exposing three atomic tools:
  - `agntux_validate` — build → lint → typecheck → tests → structural validate →
    faithful headless render, run in-process. Returns a structured verdict;
    **never throws** and **never `process.exit`s**. `render:"skipped"` is a
    success (a browserless machine still passes the hard gates), so no
    unpassable-yet-mandatory gate exists to fabricate around.
  - `agntux_write_submission` — re-validates internally (the gate — no
    caller-supplied verdict is trusted), then pure-fs+crypto writes
    `SUBMISSION.json` as a SIBLING of the plugin dir. The ONLY writer of the
    marker; nothing to hand-author.
  - `agntux_confirm_submission` — polls the daemon `.submission-status.json`
    sidecar; `queued:true` is the ONLY basis for a "submitted" claim.
- **Self-bootstrapping renderer** — on first use the server installs the
  host-renderer deps + Chromium into a managed dir
  (`~/agntux/.agntux-build/.headless-tools/`) **detached + polled**, so a tool
  call never blocks on the one-time install. `AGNTUX_BUILD_SKIP_RENDER` opts out
  (CI/tests).
- **`runValidation()` export** in `validate-plugin.mjs` — the staged pipeline as
  an importable, never-throwing function returning a structured verdict; the CLI
  is now a thin wrapper over it.
- **L2 regression guard `BUILD-types-react-dup`** — `build-plugin.mjs` asserts a
  single `@types/react` is reachable from the view-tool after install, failing
  with a routable code instead of a cryptic tsc TS2786.
- Test coverage for the L1/L2 vendoring helpers, the `runValidation`
  never-throws contract, and the MCP server's JSON-RPC failure semantics.

### Fixed
- **L1 — per-session writable package vendoring.** `build-plugin.mjs` vendored
  `@agntux/*` into a dir SHARED across build sessions
  (`…/.agntux-build/builds/packages`), which is immutable in the Cowork sandbox
  (`EPERM` on rmdir) — the in-place build could never start. It now vendors into
  a per-session sibling (`…/builds/{session-id}/packages`) it owns, never
  touching a shared dir. The scaffold's view-tool `file:` deps point at
  `../../packages` to match.
- **L2 — duplicate `@types/react` crashed tsc.** Vendoring is now **dist-only**
  (package.json with scripts/devDeps stripped, plus `dist/`/`src/`/README — never
  `node_modules`), so the vendored primitives contribute zero `@types/react`. The
  old blanket recursive copy dragged in a nested `node_modules/@types/react` that
  made `tsc --noEmit` fail with TS2786 on a correct plugin.

### Changed
- The build skill (`07-build.md`, `08-headless-test.md`, `12-submit.md`) now
  CALLS the MCP tools instead of embedding "run this verbatim" JS/bash programs.
  The stage-7 pre-flight asserts the MCP tools are callable and refuses to fall
  back to a prose program (that fallback was the exploited bypass). Hand-authoring
  `SUBMISSION.json`/`validation-receipt.json` is forbidden.

### Notes
- Render currently installs **full Chromium** (the Phase-0-proven path), not
  `chromium-headless-shell`; the headless-shell size optimisation needs the
  probe + launch-channel changed in lockstep and is deferred as a follow-up.
- The on-disk `validation-receipt.json` is a convenience record only — the MCP
  tools re-derive the verdict and never trust it.

## [0.15.1] — 2026-05-29

Fix: the 0.15.0 bundle exceeded Claude Desktop's zip-upload limit. The
`canonical/repo-mirror/` (added in 0.15.0 so lint pass 12 can resolve the
apps-client canonical without a clone) preserved full repo-relative paths,
nesting `plugins/agntux-build/canonical/ui-handlers/_template/.../apps-client/`
**11 folders deep** — uploads failed with "Zip file contains path more than 10
folders deep".

### Fixed
- Drop the agntux-build `_template` apps-client copy from `canonical/repo-mirror/`.
  It was dead weight in the bundle: lint pass 12's EXTRA_COPIES check is gated on
  `pluginSlug === "agntux-build"`, which never fires when the bundled linter runs
  (it only ever lints *contributor* plugins). Only the agntux-core canonical
  remains (8 folders deep). Deepest bundle path is now 9 (unchanged
  host-renderer dep), under the limit.
- **New lint guard E29** (`scripts/lint/lint-zip-upload-safe.ts`, pass 9): error
  on any shipped file more than 10 folders deep (relative to the zip root), so
  this class is caught at PR time instead of at upload.

## [0.15.0] — 2026-05-29

Ship the validation toolchain *inside* the plugin bundle + move the gate to
submit time. Round-1 (0.14.0) made validation a deterministic script, but a
contributor's environment had no marketplace clone — so the script, the lint
passes, and `@agntux/ui-primitives` weren't actually present to run. The build
agent, unable to run the gate, hand-fabricated a green `validation-receipt.json`
and a broken `agntux-google-calendar` reached the worker (vite build FAIL on
`useHostStyleVariables`/`buildConnectorEnvelope`; 14× E15 skill-render drift).
This release makes the gate genuinely unforgeable: the toolchain runs in the
contributor sandbox, and submission is impossible without a real, just-run
green validation.

### Added
- **In-bundle toolchain (A1).** The plugin now ships `bin/{validate-plugin,
  build-plugin}.mjs`, `scripts/` helpers (`render-skill`, `check-view-tool-imports`,
  `scaffold-marketplace-assets`, the esbuild-compiled self-contained
  `lint-marketplace-metadata.mjs`, `toolchain-layout`), the built `@agntux/*`
  packages under `canonical/packages/`, the canonical ingest sync templates, the
  scaffold's canonical assets, and a `canonical/repo-mirror/` of the apps-client
  canonical for lint pass 12 — so build + lint + render run with **no marketplace
  clone**. Vendored by `scripts/sync-agntux-build-toolchain.mjs` (single source
  of truth = the repo-root sources); a `--check` drift guard (E1) runs in CI +
  vitest.
- **`scripts/toolchain-layout.mjs`** — one resolver that locates every toolchain
  artifact for either layout (maintainer clone OR contributor bundle), detected
  by file presence. Every script resolves paths through it; nothing hardcodes
  `<repo>/scripts` or `<plugin>/bin`.
- **`scripts/check-view-tool-imports.mjs` — data-driven `@agntux/ui-primitives`
  import gate (C1).** Derives its allow/deny sets from the *actual* exports of
  the bundled `@agntux/ui-primitives` + the tree's apps-react lib, so it
  generically (a) auto-re-routes apps hooks (`useHostStyleVariables`, …) to
  `./lib/apps-react/index.js`, (b) renames the deprecated `useStructuredContent`
  → `assertStructuredContent` (specifier + call sites), and (c) HARD-fails on a
  symbol exported by nothing (`buildConnectorEnvelope`, `StickyFooter`) with a
  clear, routed message instead of vite's opaque crash. Runs before vite in
  `build-plugin.mjs`.

### Changed
- **Submit-time gate replaces the forgeable receipt (B1/B2).** The stage-12
  marker program (`12-submit.md`) now *runs* `bin/validate-plugin.mjs` against
  the exact tree being submitted and refuses to write `SUBMISSION.json` on any
  non-zero exit — there is no trusted receipt to hand-write. Build runs in place,
  so the validated bytes are the hashed/submitted bytes. The full
  build→lint→typecheck→tests→validate→render gate runs **once, at submit**;
  stage 7 relies on each specialist's own self-validation (no within-attempt
  double build). `07-build.md` + `self-validation.md` updated to match.
- **Location-independent toolchain (A2).** `validate-plugin.mjs`,
  `build-plugin.mjs`, `render-skill.mjs`, `scaffold-marketplace-assets.mjs`, and
  the marketplace linter accept `--plugin-dir <abs>` and target that exact tree;
  the linter's canonical-coupled passes (8 render-repro, 12 apps-client drift)
  resolve their canonical sources + a writable scratch dir via
  `--canonical-root` / `--apps-client-canonical-root` / `--tmp-root`. Maintainer-
  clone behavior is unchanged (defaults resolve to the repo root).
- **A3 — toolchain-present precondition.** Stage 7 asserts the bundled validator
  + packages exist before any specialist runs; if absent it STOPs and logs an
  agntux-build defect rather than ever proceeding to a hand-written receipt.
- **C2 — render reproducibility.** The authoring agents (`ingest-prompt-author`,
  `draft-flow-author`, `tests-author`, `view-tool-builder`) now require running
  the renderer (never hand-authoring `skills/<slug>/**`), make per-verb
  `_overrides/reference/{verb}-payload.md` a checked deliverable, and derive
  test-expected reference filenames instead of hardcoding — closing the 14× E15
  drift class. `connector-envelopes.md` documents that no envelope-builder export
  exists.

## [0.14.0] — 2026-05-28

Deterministic pre-submission validation gate — turn the build+lint+test+render
checks from prose the build agent was *trusted* to run into a single enforced
script, so a plugin that fails any of them can no longer reach the review queue.
Motivated by a google-calendar submission where the worker (not the build) had
to discover a broken view-tool import and 5 failing tests that should never have
escaped stage 7.

### Added
- **`scripts/validate-plugin.mjs` — the deterministic gate.** One script runs,
  in order and aborting on the first hard failure: build (`build-plugin.mjs`),
  lint (`lint:marketplace --plugin`, from the repo root where the script
  actually lives), view-tool typecheck (`tsc --noEmit`), tests (vitest in
  **both** the plugin root **and** `view-tool/` — the plugin-root config globs
  only `__tests__/**`, so the view-tool suite was previously never run),
  `claude plugin validate` (hard when the binary is present, recorded
  `skipped` otherwise), and a best-effort headless render. On success it writes
  a tree-bound `validation-receipt.json` (sibling of the plugin dir) whose
  `tree_sha256` uses the **exact** walk + exclude lists of the stage-12 submit
  program. On a hard failure it prints `{"ok":false,"failed_stage":"…"}` for the
  stage-7 loop to route to the owning specialist. Added `validate:plugin` to the
  repo-root `package.json`. Build + lint + test hard-block; render is
  best-effort (a genuine inability to obtain Chromium downgrades to
  `"skipped"`; a real render error hard-blocks).
- **`scripts/scaffold-marketplace-assets.mjs`** now also emits the plugin-root
  `package.json` (build → `build-plugin.mjs`, test → `vitest run`,
  `workspaces: ["view-tool"]`) and `vitest.config.ts` (globs `__tests__/**`)
  when absent — closing the `npm run build --if-present` / `npm test
  --if-present` silent-no-op hole that let a broken build/test sail through.

### Changed
- **`references/12-submit.md` — submission is impossible without a matching
  green receipt.** New step (b.5) runs the validator against the finalized,
  signature-carrying tree (the last mutation before submit); the step-(c)
  marker program now reads `validation-receipt.json` and **refuses to write
  `SUBMISSION.json`** unless `receipt.tree_sha256 === tree_sha256` and
  build/lint/tests are all `pass` (render may be `pass` or `skipped`). The
  receipt's result rides into the marker as a `validation` block so a
  `"skipped"` render reaches the maintainer. `validation-receipt.json` added to
  `EXCLUDE_NAMES` belt-and-suspenders.
- **`references/07-build.md`** — the stage-7 final gate is now a single
  `node scripts/validate-plugin.mjs agntux-{slug}` call, replacing the
  three-ways-broken `cd plugins/{slug} && npm install && npm run lint:marketplace
  && npm run build --if-present && npm test --if-present` block (lint didn't
  exist in the plugin dir; `--if-present` no-op'd without a root package.json;
  the view-tool suite was never reached). The 5-cycle re-dispatch loop is kept,
  now keyed on the validator's `failed_stage`. Saved state records the
  `validation_receipt` instead of a bare `build_status` string.
- **`references/self-validation.md`** and **`agents/view-tool-builder.md`** —
  per-specialist checks now reference the single `validate-plugin.mjs` gate;
  "hard exit" means the script's exit code. Fixed the stale
  `npm test --workspace plugins/{slug}` note (it missed the view-tool suite).

### Fixed (authoring — so the two google-calendar defects stop recurring)
- **`canonical/prompts/ui/host-api.md` is now the single authoritative
  import-source reference.** It previously told component authors to import
  hooks from `@mcp-apps-kit/ui-react` — which is the *upstream* package the
  vendored lib was inlined from, not a view-tool dependency — directly seeding
  the hallucinated-import defect. It now pins apps hooks to the vendored
  `./lib/apps-react/index.js` (curated to the hooks that actually export),
  enumerates the exact `@agntux/ui-primitives` export set once, and states
  plainly that **there is no `StickyFooter`** (use `ScrollablePanel`'s `footer`
  prop) and that `SimpleMcpApp` is internal transport never imported by
  component code. `agents/ui-handler-author.md` now points at it (no duplicated
  list); `agents/view-tool-builder.md` gained a deterministic
  known-wrong-import → real-source remediation step run before the generic
  build loop.
- **Per-verb payload reference files are now a required deliverable.**
  `agents/draft-flow-author.md` (§2a.1) + `agents/ingest-prompt-author.md`: for
  every non-`compose` body header the write-back emits (`## RSVP payload`,
  `## Schedule payload`, …), author the matching additive
  `_overrides/reference/{verb-kebab}-payload.md`. `agents/tests-author.md`: a
  test asserting those files exist must **derive** the expected filenames from
  the plugin's own `_overrides/reference/*.md` / `## * payload` headers, never
  hardcode plugin-specific names (the google-calendar test hardcoded names that
  didn't match the missing files). `render-reproducibility.test.ts` is left
  as-is (already filename-agnostic).

### Tested
- New `__tests__/validate-plugin.test.ts` proves the validator's `tree_sha256`
  is byte-identical to an independent reimplementation of the stage-12 marker
  algorithm, that the exclude lists drop `node_modules`/cruft/the receipt while
  keeping `view-tool/dist`, and that the hash moves when a tracked file changes
  but not when only an excluded file is added.
- `__tests__/submit-marker-program.test.ts` extended for the receipt gate:
  the happy path now writes a matching receipt and asserts the `validation`
  block rides into the marker; new cases prove submission is refused on a
  missing receipt, a stale receipt (different tree), and a receipt recording a
  failing build/lint/tests — and that re-validating after an edit lets submit
  proceed.

## [0.13.0] — 2026-05-28

Stage-12 submission reliability — close the silent-failure gap where a build
could report "submitted" while the desktop daemon silently skipped a
non-conforming marker and nothing reached the review queue.

### Fixed
- **Stage 12 now writes `SUBMISSION.json` via a deterministic program, not by
  hand.** `references/12-submit.md` step (c) replaces the prior hand-authored
  marker (which could regress into a slim "summary" with the wrong keys, or be
  written *inside* the `agntux-{slug}/` dir) with a single copy-and-run program
  that enumerates the tree, computes every `sha256` + `tree_sha256`, assembles
  the full wire-shape marker, writes it atomically to the **session root**
  (sibling of the plugin dir), and **self-checks** the exact gates the daemon
  applies (`schema_version`, `kind: "agntux-build.submission"`, `status:
  "final"`, non-empty `files[]`, correct location). The self-check runs on the
  in-memory marker **before** the atomic write, so a marker the daemon would
  skip is never left on disk; it also validates the `contributor.json` fields
  and the 4096-file cap, and guards a missing `CLAUDE_PLUGIN_ROOT`. If any
  check fails the program throws — the flow can no longer claim success on a
  marker that wouldn't queue.
- **Stage 12 now confirms the submission was actually queued before claiming
  success.** New step (e·confirm) polls the daemon's `.submission-status.json`
  sidecar: success copy only on `ok: true`; surfaces the `reason` on
  `ok: false` (incl. server-side rejections like `invalid_revision_of`); on no
  sidecar it reports "finalized, will queue once signed in" rather than
  asserting submission. This closes the silent-failure gap for server-rejected
  markers, not just malformed ones.
- **`references/07-build.md`** corrected: the marker's primary-key field is
  `submission_id` (not `id`) — the prior wording could seed the malformed-marker
  regression when `last-submission.json` was reconciled.

### Changed
- `references/12-submit.md` step (d) is now a field reference for the shape the
  step-(c) program emits, rather than instructions to author the marker.
- `references/12-submit.md` step (b): the copy-exclude list and the step-(c)
  program's `EXCLUDE_DIRS`/`EXCLUDE_NAMES` are now explicitly the same set;
  dropped the stale "exclude `NOTICE`" bullet (a plugin's `NOTICE` ships when
  present — only agntux-slack/gmail lack one).

### Tested
- New `__tests__/submit-marker-program.test.ts` extracts the step-(c) program
  from the markdown and runs it against a synthetic tree: asserts node_modules
  + `.DS_Store` exclusion, `NOTICE` inclusion, session-root placement,
  `tree_sha256` round-trip, and that an empty tree / bad `contributor.json`
  throws and writes no marker. The behavior, not just the prose, is now locked.

## [0.12.1] — 2026-05-28

Doc/prompt cleanups surfaced by the 0.12.0 review — no behaviour change to the
build flow's public surface.

### Changed
- **License is Apache-2.0, not ELv2.** `manifest-author.md`'s `plugin.json`
  example + prose and `release-checker.md`'s README template / checklist now say
  `Apache-2.0` (matching the marketplace relicensing); the stale ELv2
  managed-service / hook-bypass checklist item is replaced with the Apache-2.0
  `NOTICE`-retention requirement.
- **Dropped references to the retired `agents/ui-handlers/{name}.md` operational
  manifest.** `manifest-author.md` (intent naming), `draft-flow-author.md`
  (§2 + verify), and `tests-author.md` (the `connector-envelope.test.ts`
  example, which used to parse the now-deleted manifest YAML) now point at the
  view-tool envelope builder (`view-tool/src/.../build-envelope.ts`) — the
  current home of the connector-targeted intent contract since source plugins
  moved to the view-only shape.

## [0.12.0] — 2026-05-28

Build-time self-validation. v1 told Claude what to do in prose and hoped; v2
makes every specialist verify its own output with the real tooling before the
build can advance, and the contributor never sees a mechanical failure. Plus the
defensive fixes: a `useStructuredContent` deprecated alias and dropping the
screenshot requirement (icon-only marketplace for now).

### Added
- **Per-specialist self-validation blocks (WS-A.1).** Each of
  `manifest-author`, `ingest-prompt-author`, `view-tool-builder`,
  `tests-author`, `ui-handler-author`, and `draft-flow-author` gained a
  "Self-validation (required — hard exit)" section: it runs its specific
  validator (lint / `render-skill.mjs --validate-overrides` / view-tool build +
  `useStructuredContent` grep / `npm test`) immediately after writing its
  output, iterates up to a **5-edit retry budget**, and NEVER surfaces a
  mechanical failure to the contributor.
- **Stage-7 final-gate verifier (WS-A.2)** in `references/07-build.md`. After
  all seven specialists dispatch, the flow runs `npm install && lint && build
  --if-present && test --if-present` end-to-end and re-dispatches the owning
  specialist on any non-zero exit (up to 5 verifier→specialist loops). The build
  never reaches "ready to submit?" with an unvalidated tree.
- **`references/self-validation.md` (WS-A.6)** — the single source of truth for
  the retry budgets and the strict mechanical-vs-contributor-judgment flagging
  line. Referenced from `SKILL.md` and every specialist block.
- **`canonical/skills/_overrides/frontmatter.template.yaml` (WS-A.5)** — the
  canonical overrides template (ten render placeholders + the
  `permitted-error-kinds` list) consumed by both the scaffold script and
  `ingest-prompt-author`. One artifact, no drift.

### Changed
- **`scripts/scaffold-marketplace-assets.mjs` (WS-A.3 / WS-C.2)** is now a hard,
  unconditional top-of-stage-7 step. It emits the icon placeholder AND the
  `skills/{slug}/_overrides/frontmatter.yaml` **floor** (from the canonical
  template, substituted from build state) so lint pass 8 can always reproduce
  the skill tree (closing E15 at build time). It no longer creates
  `marketplace/screenshots/` or a `00-overview.png` placeholder.
- **`scripts/render-skill.mjs` gained `--validate-overrides <slug>`** — a
  no-render pre-flight that exits non-zero naming any unresolved placeholder.
  `ingest-prompt-author` runs it as its self-validator.
- **`references/revise.md` non-interactivity audit (WS-B.2).** Added an explicit
  `--mode revise` contract: every input the build flow elicits (identity, design
  pushback, confirmation gates, voice/gratitude, listing fields) has a
  sandbox-safe default — never prompt, never narrate. The worker dispatches the
  revise specialists unattended. Updated the code map (dropped the screenshot
  E10 row; added `BUILD-useStructuredContent`).
- **`useStructuredContent` deprecated alias (WS-C.1).**
  `@agntux/ui-primitives` now re-exports `assertStructuredContent` as
  `useStructuredContent` so older/scaffolded view-tools compile cleanly; the
  view-tool-builder grep nudges new code onto the canonical name.
- **UI designs are presented as inline HTML prototypes, never ASCII.** Stage 5
  (`05-plan-ui.md`), stage 6 (`06-design-and-preview.md`), and `SKILL.md` now
  explicitly require the pre-build wireframe to be an HTML prototype Cowork
  renders inline — fixing a case where the flow emitted hard-to-read ASCII
  mockups. Both the stage-5 wireframe and the stage-6 live Chromium preview are
  HTML; a plain-text layout is never shown to the contributor.
- Internal defect-routing prose across the specialists and `self-validation.md`
  now says "for the maintainer" rather than a personal name (matches the
  marketplace worker's no-name-in-generated-notes rule).

### Removed
- **The screenshot requirement (WS-C.2).** Screenshots are no longer scaffolded
  or required anywhere in the build flow (`06-design-and-preview.md`,
  `ui-handler-author.md`, `manifest-author.md`, `release-checker.md`, the
  scaffold script). The marketplace ships icon-only listings until a
  real-screenshot capture pipeline lands. (The stage-8 headless render still
  captures a debugging screenshot to the session dir — unrelated to marketplace
  collateral.)

## [0.11.0] — 2026-05-28

Pre-emptive scaffolder fixes so freshly built plugins clear marketplace
lint on the first try, plus a new `:revise` subcommand the submission
worker invokes to apply review feedback without restarting the build.

### Added
- `:revise` subcommand (`/agntux-build:revise <slug> [--fixes <code,code>] [--mode revise]`) — routes review feedback directly to the relevant specialist agent (E05 → manifest-author, E15 → ingest-prompt-author, etc.) without re-running stages 1–5. Reads `<project>/.agntux-build/last-submission.json` to capture `revision_of` for the new SUBMISSION.json; does NOT bump `plugin.version` (revisions stay on the same version since the prior submission never shipped). In `--mode revise`, suppresses voice/gratitude and the conversational stages — designed to be invoked non-interactively by the submission worker.
- `scripts/scaffold-marketplace-assets.mjs` — idempotent stage-7 helper that copies a 512×512 icon placeholder to `marketplace/icon.png` if absent, ensures `marketplace/screenshots/00-overview.png` exists, removes any rogue `marketplace/screenshots/README.md` (the source of E10 misnames), and emits a placeholder-note marketplace README.
- `canonical/marketplace-assets/icon.placeholder.png` — 512×512 PNG used by the scaffold helper.
- `canonical/ui-handlers/_template/src/lib/apps-client/` — authoritative vendored copy of the apps-client TypeScript module. The plugin-bundle path under `${CLAUDE_PLUGIN_ROOT}/canonical/` is now a fallback only; when both exist they must be byte-identical.
- `packages/agntux-ui-primitives` — `assertStructuredContent<T>()` typed accessor over already-unwrapped tool output (closes the E27 missing-import build failure surfaced in the first live submission).

### Changed
- `agents/manifest-author.md` — char-cap reference table now inlined at the top of the listing.yaml authoring section (description ≤500, ui_components[].purpose ≤200, proposed_schema.cursor_semantics ≤200) with an explicit "draft under the cap, re-read and trim" instruction per long-string field.
- `agents/release-checker.md` — initial-scaffold CHANGELOG template now seeds both `## [Unreleased]` and the first versioned section `## [{plugin_version}] — {today-iso-date}` with `### Added\n- Initial release.` underneath.
- `agents/ingest-prompt-author.md` — new "Stage 7: emit `_overrides/frontmatter.yaml`" section with the full substitution map (`plugin-slug`, `source-slug`, `source-display-name`, `example-channel`, `permitted-error-kinds`); closes the E15 render-reproducibility gap at scaffold time.
- `agents/view-tool-builder.md` — stage 7 now vendors `apps-client` via `rsync --no-links -a canonical/ui-handlers/_template/src/lib/apps-client/ plugins/{slug}/view-tool/src/lib/apps-client/` (or node equivalent); closes E27.
- `agents/ui-handler-author.md` + `skills/build/references/06-design-and-preview.md` — stage-6 preview capture now emits `marketplace/screenshots/00-overview.png` (1280×720). The flow never writes `README.md` into `screenshots/` — the fallback path is the scaffold helper's placeholder, not a text file.
- `skills/build/references/07-build.md` — invokes `scripts/scaffold-marketplace-assets.mjs --slug {slug}` as a pre-build scaffold step; writes `<project>/.agntux-build/last-submission.json` at end of stage 12 (so `:revise` can read it next time).
- `skills/build/SKILL.md` — first-token routing now recognises `revise` → `references/revise.md`.

## [0.10.0] — 2026-05-28

A live test of the `/agntux-build:build` flow surfaced a cluster of
copy and voice issues plus one missing post-submission hand-off.
0.10.0 fixes them — all hand-authored markdown in the build skill, no
behaviour change to the connector contract, prompts, or UI components.

### Changed

- **Never narrate the design rules unprompted; stop the issues-page
  redirect for design pushback.** The flow no longer pre-announces the
  light-mode/colour-scheme rule before the user raises it, and design-
  rule pushback is now answered with "state the rule and move on"
  rather than a redirect to the issues page. The underlying standards
  stay fully enforced (light mode, design tokens, one Send button) —
  only the proactive narration and the complaint redirect are gone.
  Touches `SKILL.md` (voice rule 4, "What you NEVER/DO" lists),
  `references/05-plan-ui.md`, `references/06-design-and-preview.md`,
  `references/design-standards.md`, `references/voice-and-gratitude.md`,
  and `README.md`. The issues link stays in genuine failure/support
  paths (installed-plugin issues, connector-auth trouble, unrecoverable
  build crash, sync-bug reports).
- **No filesystem paths in user-facing copy.** Stage 7's confirmation
  gate and self-fix one-liner no longer print build paths or session
  paths to the non-technical contributor (`references/07-build.md`).
  Internal prose, saved-state JSON, and command snippets are
  unchanged.
- **Continuous build → render-check flow.** The stage-7 build summary
  no longer reads as a turn-ending sign-off; stages 7 → 8 → 9.5 are
  now documented as one continuous unattended block with an explicit
  non-yield directive, so the orchestrator runs straight into the
  render check instead of stopping. Touches `references/07-build.md`,
  `references/08-headless-test.md`, and `SKILL.md`'s routing block.

### Added

- **"Build for everyone, not just you" principle.** A new load-bearing
  section in `SKILL.md` plus reminders woven into ingestion
  (`references/04-discover-tools.md`), UI planning/design
  (`references/05-plan-ui.md`, `references/06-design-and-preview.md`),
  and the sync-iteration over-fit hotspot
  (`references/10-sync-iterate.md`): the plugin serves every future
  user of the connector, not the contributor personally. Their data is
  for finding bugs, not for narrowing the plugin to their habits.
- **Post-submission tracking + install instructions.** Stage 12's §f
  success copy (`references/12-submit.md`) now tells the contributor to
  track review on the AgntUX desktop app's "Built by you" tab, sets a
  ~1-business-day turnaround expectation, notes that changes may be
  requested with clear instructions, and walks them through installing
  the published plugin once it's merged (Customize → AgntUX Core →
  Marketplace (AUX-plugins) → Personal → three-dot → Check for updates
  → "+" → `/agntux onboard`). A tailored update-mode variant points at
  the same tab but notes the install is automatic via Check for
  updates. A clarifier next to the "don't install locally" rule
  distinguishes the in-flow local build from the legitimate
  post-publication marketplace install. (The matching desktop-app
  surface — the same steps on the "Built by you" tab — ships
  separately in the `agntux/app` repo.)

## [0.9.0] — 2026-05-28

When AgntUX promotes a freshly-launched plugin on social, the
contributor deserves the credit. 0.9.0 adds a final step to the
build flow that asks the contributor — once, at the end, after
sync iterations have converged — whether they want to be tagged
in promo posts, and which handles to use.

### Added

- **Stage 11 — credit-info capture.** A new stage between
  sync-iterate (10) and submit (12) that asks the contributor for
  optional public-credit handles: X / Twitter, LinkedIn,
  Instagram, Reddit. The prompt lays out explicit consent up front
  — "we may publish these on the agntux.ai plugin page and tag you
  in social posts promoting your plugin" — and skipping is a
  fully supported answer. Lenient normalisation: any of `@jane`,
  `jane`, `https://x.com/jane` resolves to the bare handle `jane`.
  See [`references/11-credit-info.md`](skills/build/references/11-credit-info.md).
- **Optional `socials` block on `contributor.json`.** Stage 11
  appends a `socials` block carrying the provided handles plus a
  `credit_consent_at` ISO timestamp. The block is only written
  when the contributor provided at least one handle; skipping the
  step leaves the file untouched. Stage 0's spec was updated to
  document the field; future re-writes of `contributor.json` must
  preserve a pre-existing `socials` block (merge, don't overwrite).
- **`contributor.socials` in the submission marker.** Stage 12's
  `SUBMISSION.json` now embeds the `socials` block verbatim from
  `contributor.json` when present, alongside the existing
  `contributor.name` / `contributor.email`. The marker is stored
  verbatim in `plugin_submissions.marker` jsonb on the AgntUX
  side, so the credit handles ride into the submission record
  without a database migration. Marker `schema_version` bumped
  `1.0.0 → 1.1.0` (additive: the new field is optional, old
  markers without it still validate).

### Notes

- Stage 11 only ever asks knowledge-worker channels (X, LinkedIn,
  Instagram, Reddit). GitHub / Bluesky / Mastodon / personal
  website are deliberately not asked — the contributor pool this
  flow exists for isn't engineers, and a five-field wizard at the
  end of a long session is bad UX. If the contributor volunteers
  other links, accept them politely but don't persist them.
- `CONTRIBUTING-SIGNATURE.md` is unchanged — the signature is the
  DCO record only and never carries social handles. Credit
  metadata lives exclusively in the `SUBMISSION.json` marker.

## [0.8.0] — 2026-05-27

A live test run dead-ended at the very last step: agntux-build built a
plugin, zipped it, and asked the user to email the zip to
`plugins@agntux.ai` — and **Gmail blocked the attachment** ("does not
allow this type of file … executables and archives"). For the
non-technical contributors this plugin exists to serve, that's a wall.
0.8.0 removes the zip-and-email channel entirely and replaces it with
auto-sync through the AgntUX desktop app.

### Changed

- **Submission is now finalize-for-sync, not zip-and-email.** Stage 12
  (`references/12-submit.md`) writes the contributor's
  `CONTRIBUTING-SIGNATURE.md` into the plugin tree, guarantees the tree
  sits in the synced
  `<agntux project root>/.agntux-build/builds/{session-id}/agntux-{slug}/`
  location (copying out of a marketplace clone with the existing
  exclude list when needed), then writes a `SUBMISSION.json`
  finalization marker — last, atomically (tmp + rename) — as a sibling
  of the plugin dir. The AgntUX desktop daemon already syncs the whole
  `<agntux project root>/` tree to S3 (content-addressed by sha256), so
  no upload code is needed: the marker carries each file's sha256 (the
  S3 blob keys) plus a `tree_sha256` dedup key, the daemon detects it
  and POSTs it to the web app, and the submission is recorded and
  tracked through a `queued → processing → success | error` lifecycle.
  There is **nothing for the contributor to download, attach, or
  email.**
- **Sync is hard-required.** Stage 12 checks that both
  `<agntux project root>/.agntux/teams.json` and
  `.agntux/daemon.lock` are present (the desktop app running and signed
  in) before claiming success. If the app isn't active, the marker is
  still written (it syncs the moment the app starts) but the flow tells
  the user to start/sign into the AgntUX desktop app and stops — it
  never claims a plugin was submitted when nothing can carry it.
- `references/update-mode.md` stage 12 follows the same marker flow
  with `mode: "update"` and a top-level `previous_version`, plus the
  matching `submission.mode` / `submission.previous_version` in
  `CONTRIBUTING-SIGNATURE.md`.
- `SKILL.md` stage-12 routing row reworded from "zip once / email
  `plugins@agntux.ai`" to the finalize-for-sync description.
- Saved state's `submission` block drops `zip_path` / `draft_method` /
  `draft_connector` and adds `marker_path`, `tree_sha256`, and
  `sync_active`.

### Removed

- **The zip artefact and every email path.** Gone from stage 12: the
  Cowork zip download card, `SUBMISSION-EMAIL.txt`, the
  Gmail-compose / `mailto:` convenience links, the entire Step A–C
  connector-detection email flow, and the cross-platform Downloads
  path table. No plugin file is zipped anymore.

### Why

The built plugin files already live under `<agntux project root>/`,
which the AgntUX desktop app syncs to S3 today (verified end-to-end:
the daemon watches the whole tree and excludes only the exact
`.agntux/` dir, so `.agntux-build/` is tracked). Routing submission
through that existing sync channel removes the attachment-type block
that dead-ended the email flow and makes submission a no-action step
for the contributor. The S3-pull ingestion worker that opens the PR
into the public marketplace is deliberately deferred — the recording
and status endpoints are built so it just pulls the queue and patches
status.

## [0.7.0] — 2026-05-27

A live test of the `/agntux-build:build` flow in Cowork surfaced three
rough edges in the submission stages, all now fixed.

### Added

- **Connector-aware submission email.** Stage 12 now detects installed
  AgntUX email plugins (via `mcp__plugins__list_plugins`, falling back
  to `~/.agntux/installed-plugins.json`) and, when one is
  email-draft-capable (a `communication`-category plugin with a compose
  `ui_components` entry and a `requires_source_mcp.connector_slug`),
  drafts the submission to `plugins@agntux.ai` directly through that
  connector's create-draft tool (e.g. `mcp__claude_ai_Gmail__create_draft`)
  after an explicit confirm. The contributor reviews and sends it
  themselves. Mirrors agntux-core onboarding's plugin-detection idiom
  (`skills/_preconditions.md` check 0.5).

### Changed

- **Zip once, at submission.** Removed the stage-9 snapshot zip
  (`references/09-zip.md` deleted) — it was written right after the UI
  build, *before* the stage-10 sync-iteration loop edited the prompts,
  so the snapshot was stale the moment it was made. Stage 12 is now the
  single place that zips, with the full cross-platform Downloads
  resolution + contents tree + excludes recipe folded inline. Flow reads
  8 → 9.5 → 10 → 12.
- **No absolute zip path in user-facing copy.** Stage 12 relies on
  Cowork's auto-rendered zip card and its **Show in Finder** button
  instead of printing the path. `zip_path` stays in saved-state JSON
  (internal only).
- **Slimmer submission email.** Dropped the `View tools (N):` and
  `Intercepted mutation payloads:` blocks from the body — the zip
  carries full detail and long bodies bloat the convenience links. Body
  is now a short plugin summary + contributor info + DCO sign-off.
- **Convenience links degrade cleanly and encode parens.** When no email
  plugin is installed, stage 12 presents an Open-in-Gmail-compose link, a
  `mailto:` link, and the copy-paste `SUBMISSION-EMAIL.txt` card
  together. Emitted links now encode `(`/`)` as `%28`/`%29` (a raw `)`
  ends a markdown link early). Recorded empirically: `mailto:` dead-ends
  for webmail users (macOS routes it to Chrome, which has no mail
  web-handler registered), so it can never be the primary path — it's
  one fallback among several.
- `references/update-mode.md` aligned to the same concise body and the
  same Step A–C draft mechanism.

## [0.6.1] — 2026-05-25

### Changed

- **Stage 0 project-root resolution now creates `~/agntux` via a tool
  instead of asking the user to run a terminal command.** When agntux-core
  is installed, the DCO pre-flight resolves and calls
  `agntux_core_create_project_directory` to create `~/agntux`, then passes
  the returned absolute path to the host's `request_cowork_directory`.
  Falls back to the previous ask-whether-to-create behavior only when that
  tool isn't available (agntux-core not installed). Mirrors agntux-core
  10.1.0's onboarding change.

## [0.6.0] — 2026-05-21

Republish to pick up the `scripts/build-plugin.mjs` fix that lets
skill-only plugins (no `mcp-server/`, no `view-tool/`) package cleanly
through `scripts/package-plugins.mjs --all`. No in-tree source changes.

## [0.5.0] — 2026-05-20

### Changed

- **Remote-view-only generation by default.** The build skill now
  scaffolds plugins that match the agntux-slack / agntux-gmail shape
  exactly — `view-tool/` plus `skills/`, `marketplace/`, `__tests__/`,
  and root files. No `mcp-server/`, no `hooks/`, no `.mcp.json`. The
  marketplace.json entry is auto-tagged `kind: "remote-view-only"` by
  `scripts/regenerate-marketplace-json.ts` based on the absence of
  `mcp-server/` AND presence of `view-tool/`.
- **Headed Playwright preview in stage 6.** `host-renderer/` was
  reworked to load the plugin's compiled view-tool ESM module
  in-process (no MCP server spawn) and launch a real Chromium window
  via Playwright. The user clicks around the iframe; every mutation
  tool call from `useAppsClient().callTool()` is intercepted, logged
  to stdout + the new `/api/intercepts/stream` SSE channel, and
  stubbed with a success envelope. Mutations never fire against a
  real connector during iteration.
- **Stage 8 simplified.** Repurposed as a single-screenshot
  regression smoke pass per view tool. The stage-7.5 compile gates
  (which targeted `mcp-server/tsconfig.json` and the embed step)
  were removed — none of them apply to view-tool-only plugins.
- **Stage 9 renamed to `09-zip.md`.** The "and-install" half is
  gone. Source plugins can't be installed locally in Claude Cowork
  (its local-stdio path is broken for view tools), so the zip is
  now purely a snapshot for the user and an artefact for the
  stage-12 mailto handoff.
- **Stage 12 simplified.** Removed the team-publish branch (the
  matching MCP tool `agntux_build_publish_to_team` was deleted with
  the mcp-server below). The mailto flow to `plugins@agntux.ai` is
  the sole submission path.

### Removed

- **Stage 11 (`11-triage-ui-test.md`) deleted entirely.** The "first
  real install walk" can't run — Claude Cowork's local-stdio path
  doesn't load view tools — and the iframe-shape regression it
  guarded against is now caught by stage 6's headed preview + stage
  8's regression screenshot. Stage 10 advances directly to stage 12.
- **`plugins/agntux-build/mcp-server/` deleted.** Its only tool
  (`agntux_build_publish_to_team`) was the team-publish backend
  that stage 12 has now dropped. agntux-build itself becomes a
  skill-only plugin.
- **`canonical/ui-handlers/_template/` documentation updated.**
  The README's layout diagram no longer references a sibling
  `component/` directory (which never existed in this template
  tree) and explicitly calls out the no-mcp-server invariant.

### Why

Three coordinated forces:

1. **Remote MCP is the new deploy target.** Commit `8226448`
   (agntux-core 10.0.0) moved mutation tools out of local
   `mcp-server/` into `view-tool/` for runtime loading by the remote
   MCP server. Source plugins (agntux-slack, agntux-gmail) had
   already adopted the no-mcp-server shape; agntux-build was still
   scaffolding the old one.
2. **Claude Cowork's local-stdio path is broken for view tools.**
   The "build → zip → install locally → click action button" loop
   the prior stage-11 workflow assumed simply doesn't execute. The
   only place mutation tools actually fire is on the remote MCP
   server post-deploy.
3. **Headed Playwright is enough.** The user doesn't need a real
   install to validate the iframe shape and the mutation envelope
   payload — a Chromium window driven by Playwright with intercepted
   tool calls makes both visible during iteration.

### Migration

This release is for contributors who run `/agntux-build:build`.
Existing generated plugins on disk are unaffected; the change only
shapes new generation. If you have a plugin tree from a previous
agntux-build that contains `mcp-server/`, delete it manually before
re-zipping for submission.

## [0.4.1] — 2026-05-18

### Changed

- **Canonical view-tool template now bakes the response-envelope
  rule in.** `plugins/agntux-build/canonical/ui-handlers/_template/
  view-tool/src/__ui-name__-view.ts` imports
  `renderConfirmationText` from `@agntux/plugin-runtime`, ships a
  `content[].text` block on both the success and not-found branches
  of the handler, and the descriptor's appended description suffix
  was reframed from a forbid-list ("do NOT add any chat commentary
  …") to an explanation of the MCP Apps lifecycle ("This tool is
  an MCP App view tool: it returns a structured data payload that
  the host renders into an interactive iframe …"). A new
  `{{ui-display-name}}` placeholder is referenced inline so scaffold
  authors supply a human-readable label per view tool. Test scaffold
  at `__tests__/payload-shape.test.ts` extended with a "response
  envelope guard" describe block.
- **`agents/ui-handler-author.md`** gained §3.1 ("Response envelope
  rule (load-bearing)") documenting the `renderConfirmationText`
  contract and the production bug it guards against, and §3.2 ("If
  your tool's success path doesn't render the iframe, it isn't a
  view tool") making the scope rule explicit so authors don't abuse
  the view-tool surface for non-rendering side effects.

### Why

Production bug observed in Claude Cowork on 2026-05-18 — see
`@agntux/plugin-runtime` 0.2.1, `agntux-core` 10.0.1,
`agntux-slack` 8.2.1, `agntux-gmail` 4.2.1. Plugins scaffolded from
the template inherit the fix automatically. PATCH-level: template
change only, no shipped behavior change.

## [0.4.0] — 2026-05-18

### Changed

- **Scaffold templates inherit the five sibling-plugin improvements
  from agntux-slack 8.2.0 / agntux-gmail 4.2.0 / agntux-core 9.8.0**,
  so every plugin scaffolded going forward gets them for free:

  1. **Working-hours cadence default.** `recommended_ingest_cadence`
     example bumped to `Every 60 min, 7am–7pm weekdays local`
     everywhere a default is shown — `agents/manifest-author.md`
     (rubric examples), `skills/build/references/04-discover-tools.md`
     (planning example), `skills/build/references/09a-onboarding-
     iterate.md` (fallback when `plugin.json` doesn't carry one),
     and the maintainer `.claude/commands/scaffold-plugin.md`
     seeded value. `STUBS.md` placeholder doc updated to recommend
     the same default.
  2. **Bare slash-command host_prompts.** Canonical
     `prompts/ingest/skills/sync/reference/sync.md` now emits
     `"/{{plugin-slug}} {imperative} for action {id}"` instead of
     the legacy `"ux: …"` form. `agents/ingest-prompt-author.md`,
     `agents/draft-flow-author.md`, and
     `canonical/prompts/agntux-core-hub-contract.md` updated to
     match. Legacy form still accepted by the schema for backwards
     compatibility.
  3. **Stop-after-rendering directive on view-tool descriptors.**
     `canonical/ui-handlers/_template/view-tool/src/__ui-name__-
     view.ts` automatically appends the canonical "Once this UI is
     rendered, the user sees everything they need in the iframe —
     do NOT add any chat commentary after rendering, and do NOT
     make any further tool calls" suffix to every descriptor, so
     authors don't have to remember and can't accidentally double
     it up. `_template/README.md` and `agents/ui-handler-author.md`
     document the convention.
  4. **Iframe-height floor + initial size signal.**
     `_template/view-tool/src/__ui-name__-ui.tsx` now sets a 480px
     `min-height` on documentElement / body / `#root` BEFORE mount
     so the first reported `scrollHeight` is at least the floor.
     The vendored `_template/view-tool/src/lib/apps-client/
     simple-mcp-app.ts` emits one initial `ui/notifications/
     size-changed` synchronously when
     `setupSizeChangedNotifications()` runs. Copied byte-identical
     from the canonical at `plugins/agntux-core/view-tool/src/lib/
     apps-client/simple-mcp-app.ts` to satisfy linter pass 12.
  5. **Native-UI suppression rule for write-back envelopes.**
     `agents/draft-flow-author.md` now carries an authoring rule
     requiring every envelope builder that dispatches to a third-
     party connector with its own MCP App UI (Slack, Gmail, Linear,
     etc.) to append a directive telling the host to call the tool
     programmatically and not render the connector's native UI.
     `canonical/ui-handlers/slack-thread/handler/slack-thread.md`
     and `canonical/mcp-server-templates/orchestrator/src/tools/
     pivot.ts` updated to the new prefix as well.

## [0.3.0] — 2026-05-17

### Added

- **Canonical scaffold restored to rich-UI shape.**
  `canonical/ui-handlers/_template/view-tool/src/` now ships the
  full pre-P5 React tree (App.tsx, components/, hooks/,
  lib/apps-client/, lib/apps-react/, `__tests__/` with 113 tests
  worth of patterns) plus 11 locale files at `view-tool/locales/`.
  New plugins scaffolded from this template inherit the rich
  surface, not a `Loading…` placeholder.
- `view-tool/vitest.config.ts` template — jsdom env, registers
  `src/__tests__/setup.tsx`, includes both `src/__tests__/**` and
  the `__tests__/payload-shape.test.ts` regression guard.

### Changed

- **Marketplace lint pass 12 (`scripts/lint/lint-apps-client-drift.ts`)
  now scans recursively.** Plugins with the rich shape that ship
  per-UI vendored copies under
  `view-tool/src/apps/{ui-name}/lib/apps-client/` get every copy
  byte-equality-checked, not just the slim
  `view-tool/src/lib/apps-client/` shape. Closes the gap where
  agntux-slack's compose + canvas vendored copies would have been
  invisible to the drift check.
- Pass 12 `EXTRA_COPIES` drops the obsolete `_template/component/`
  path; the post-P5 `_template/view-tool/` is the only template
  surface.
- Apps-client `config.ts` swaps `declare global { const X }` for
  `var` so multi-UI plugins with two vendored apps-client copies
  in the same tsconfig don't fail with TS2451 ("Cannot redeclare
  block-scoped variable").

### Removed

- Deleted `canonical/ui-handlers/_template/component/`. The
  post-P5 `_template/view-tool/` is now the single source of
  truth for scaffolded plugins; the component/ stub was a
  pre-rich-restore artifact.

## [0.2.4] — 2026-05-17

### Added

- Marketplace linter pass 12 (E26 error / E27 warning) enforces
  byte-equality across every vendored copy of
  `simple-mcp-app.ts` and `constants.ts`. Catches the
  silent-regression class where a future bugfix lands in one of the
  six vendored copies but not the others — the affected plugin's
  iframe would silently fail to render while the others work fine.
  Canonical source pinned at
  `plugins/agntux-core/ui-handlers/triage/component/src/lib/apps-client/`;
  every other copy (3 view-tool/ vendors + 2 _template paths) must
  hash-match.
- Canonical view-tool scaffold at
  `canonical/ui-handlers/_template/view-tool/src/__ui-name__-ui.tsx`
  renders a `connect_error` state on `SimpleMcpApp.connect()`
  failure instead of leaving the iframe on "Loading…" forever. New
  plugins scaffolded from the template inherit this UX.

### Fixed

- `SimpleMcpApp` (vendored in both `_template/component/` and
  `_template/view-tool/`) gates verbose `[SimpleMcpApp] incoming
  message:` logs behind `window.__MCP_APPS_DEBUG__`. Reduces console
  noise to zero on a healthy iframe.

## [0.2.3] — 2026-05-17

### Fixed

- Canonical view-tool scaffold at
  `canonical/ui-handlers/_template/view-tool/src/__ui-name__-ui.tsx`
  now wires the canonical `SimpleMcpApp` wrapper from the vendored
  `view-tool/src/lib/apps-client/` directory. Previous template
  imported `useToolResult` from `../../component/src/lib/apps-react`,
  which assumed a specific component/ subtree layout that the
  existing live plugins (agntux-core, agntux-slack, agntux-gmail)
  don't ship — meaning newly-scaffolded plugins inherited a different
  iframe-protocol pattern than the live ones. 0.2.3 aligns the
  canonical with the live-plugin pattern (direct SimpleMcpApp
  import) so new plugins ship with the same iframe wiring as
  agntux-core 9.5.4 / agntux-slack 8.0.4 / agntux-gmail 4.0.4.

  See agntux-core/CHANGELOG.md → 9.5.4 for the bug class this
  pattern exists to prevent (the bare `data.type === "tool-result"`
  listener never matches the MCP Apps JSON-RPC envelope per the spec
  at `ext-apps/specification/2026-01-26/apps.mdx`).

## [0.2.2] — 2026-05-17

### Added

- Canonical view-tool scaffold now ships
  `__tests__/payload-shape.test.ts` — a starter regression-guard
  test that asserts `structuredContent` stays under a byte budget
  and the row keys exactly match the iframe's rendered set. Targets
  the agntux-core 9.5.3 bug class (a saturated `triage_view`
  workspace shipping ~62 KB per call and getting rejected by the
  host's max-tokens cap before reaching the chat model). The
  scaffolded test is intentionally a **template** — its size-budget
  assertion exercises a long `title` payload (the field the canonical
  handler actually forwards through `parsed.frontmatter.title`) but
  the in-fixture `body` does NOT inflate the wire payload because
  the canonical handler's `parsed.body ?? ""` resolves to `""` (the
  `ParsedAction` interface has no `body` field — pre-existing
  template shape that authors fix when they wire up their real
  handler). Scaffold authors MUST update `KEPT_KEYS`,
  `PAYLOAD_BUDGET_BYTES`, and the heavy-payload fixture to match
  their plugin's actual structuredContent shape; the canonical comment
  block in the test file walks through the customisation points.
- Canonical `__ui-name__-view.ts` carries a new "Payload-shape rule"
  comment block pointing at the regression-guard test and the
  agntux-core CHANGELOG entry that motivates it.
- `skills/build/references/07-build.md` updates the `tests-author`
  specialist's contract: for any plugin that ships `view-tool/`,
  generate the payload-shape test from the canonical scaffold and
  tune the tunables to the plugin's actual shape (rather than
  copying the template verbatim).
- Marketplace linter pass 11 (E24/E25, warning-severity) flags any
  plugin that ships `view-tool/` without a payload-shape test, or
  with a test that lacks a byte-size assertion. Warning rather than
  error so existing plugins without the test (agntux-slack,
  agntux-gmail) don't break CI; promote to error once every plugin
  ships the file.

## [0.2.1] — 2026-05-16

Republish at fresh tag. No source changes — pairs with the agntux/app
remote MCP loader's pin-resolver requirement that `agntux-build@${version}`
tags point at a commit containing the rebuilt `mcp-server/dist/` tree.

## [0.2.0] — 2026-05-12

Adds team-aware Stage 0 detection + Stage 12 team-publish path
behind the `<root>/.agntux/teams.json` runtime gate (P3 / S3.3).
Solo behavior is byte-identical: with no `teams.json` present,
Stage 0 records no team context and Stage 12 emits the same
`mailto:plugins@agntux.ai` body and zip as `0.1.5`.

When `teams.json` is present, Stage 0 offers the user the team(s)
they're a member of (or "submit publicly" to opt out) and Stage 12
calls a new MCP tool `agntux_build_publish_to_team` instead of
opening a `mailto:` link. The tool reads the license JWT from
`teams.json`, walks the built plugin directory, and POSTs the
manifest to
`app.agntux.ai/api/teams/{org_slug}/marketplace/publish`. The
backend verifies the license JWT, re-validates the DCO trailer,
and commits the plugin tree under `plugins/{plugin-slug}/` in the
org's private marketplace repo.

Adds a minimal MCP server under `mcp-server/` that ships exactly
this one tool. Solo runs never invoke it.

## [0.1.5] — 2026-05-10

Corrects two assumptions in the stage-9.5/10 inline-execution flow
that surfaced when contributors tried to build against a real source.

Onboarding logic lives in `agntux-core` — driven by the source
plugin's declarative `marketplace/listing.yaml` metadata
(`tagline`, `purpose`, `supported_prompts`, `proposed_schema`) and
`.claude-plugin/plugin.json → recommended_ingest_cadence`. Source
plugins never owned onboarding prompts; the old stage-9.5 hunt for a
`## Onboarding` section in `skills/agntux-{slug}/SKILL.md` was based
on a wrong mental model and produced a skip-path on every real
plugin, leaving stage 10's sync run without the personalization it
needs.

Separately, stage 10 was writing entities, actions, learnings, and
cursor state to a scratch directory under
`.agntux-build/sessions/{id}/sync-output/`. The contributor's real
`data/` directory was untouched, but the build session still left
filesystem residue from the sync pass. Stage 10 is now strictly
analyze-only — pulls source data via read tools, runs compose logic
in conversation, emits "would create / would raise" tables, persists
nothing.

### Changed
- **Stage 9.5 rewritten as test-personalization synthesis.**
  `references/09a-onboarding-iterate.md` now ships a fixture-and-
  synthesis flow. Loads the shared test persona from
  `skills/build/fixtures/test-persona/`, reads the source plugin's
  `marketplace/listing.yaml` + `.claude-plugin/plugin.json`, and
  reads the canonical per-plugin interview shape from
  `plugins/agntux-core/skills/agntux/reference/onboard.md` ("Per-
  plugin onboarding interview" section). Synthesizes three
  in-conversation blocks — simulated `user.md`, simulated
  `data/instructions/{slug}.md`, simulated
  `data/schema/contracts/{slug}.md` — and shows the contributor a
  one-screen summary with an accept / edit / regenerate choice
  (cap 3 revisions). No interview of the contributor; nothing
  written to disk. The skip-path is removed (every plugin gets
  synthesized personalization). When core's interview shape evolves,
  build inherits the new shape at runtime without a re-render.
- **Stage 10 rewritten as analyze-only.**
  `references/10-sync-iterate.md` no longer resolves a scratch
  knowledge-store root. The build skill reads stage 9.5's
  synthesized personalization from conversation context, executes
  canonical sync steps 0–11 inline against authorized source MCP
  **read** tools, and captures every would-be write as in-memory
  state. A structured-table summary (would create / would update
  entities, would raise / defer / resolve / merge actions, cursor
  diff, items processed) replaces the prior scratch-dir writes. No
  entity files, no action files, no learnings/cursor file, no
  scratch directory. The session JSON at
  `.agntux-build/sessions/{id}.json` stays the only sync-related
  write and carries summary counts only. Source MCP **write** tools
  are never called.
- **Session-record schema updated** (`SKILL.md:103-122`). Dropped
  fields: `onboarding_present`, `onboarding_completed`,
  `onboarding_iterations`, `onboarding_capture_path`,
  `inline_sync_scratch_dir`. Added fields: `onboarding_mode`
  (always `"synthesized"`), `persona_fixture_version`,
  `synthesis_revisions` (cap 3), `dry_run` (always `true`),
  `simulated_entity_writes`, `simulated_action_writes`. Resume rule
  changed: mid-9.5 resume regenerates synthesis fresh (cheap)
  rather than splicing partial state.
- **Stage 10 install-mode fallback now warns about the analyze-only
  guarantee breaking.** When the source MCP isn't reachable inline
  and the contributor has to install-and-run, the skill explicitly
  flags that installed sync writes to the host's data root and
  recommends a throwaway `agntux` project root for that path.

### Added
- **`skills/build/fixtures/test-persona/`** ships with the plugin:
  `user.md` (generic-but-plausible PM-at-fictional-SaaS profile,
  type: `user-config`, fixed `bootstrap_window_days: 30`),
  `schema/_seed.md` (generic entity-subtype baseline that
  stage 9.5 extends with the source plugin's `proposed_schema`),
  and `README.md` (explains the fixture's purpose and how stage 9.5
  uses it).

## [0.1.4] — 2026-05-10

Weaves Cowork-native tools into four touch points in the build flow,
each behind `ToolSearch` + graceful degradation so non-Cowork hosts
(claude-desktop, MCPJam) keep working unchanged. Mirrors the
established idiom from `agntux-core`'s onboarding skill.

### Changed
- **Stage 9 — zip handoff renders as a Cowork download card.**
  `references/09-zip-and-install.md` now tries
  `mcp__cowork__present_files` with the absolute zip path before the
  prose handoff. On resolve, the user sees an inline download card and
  the prose drops the redundant bold path line. On miss, the prose
  fallback is byte-identical to today.
- **Stage 4 — empty tool-inventory falls back to the MCP registry.**
  When `ToolSearch` on the connector display name returns zero results
  (the connector lapsed auth or stage 3 was skipped), the skill now
  tries `mcp__mcp-registry__search_mcp_registry` to locate the
  connector and renders `mcp__mcp-registry__suggest_connectors` so the
  user can re-auth from a one-click chat card. On miss, falls back to
  re-loading stage 3.
- **Stage 1 — already-installed branch uses `suggest_plugin_install`
  for the install card.** When the marketplace match is positive, the
  skill now renders `mcp__plugins__suggest_plugin_install` with the
  matched `agntux-{slug}` entry only — the pluginId comes from our own
  `marketplace/index.json`, never from a host-wide plugin search, so
  scope stays AgntUX-only. On miss, falls back to printing the slug +
  the GitHub link to the plugin tree.
- **Stage 12 — final submission renders zip + email body as cards.**
  The skill writes the rendered submission email body to
  `{build-path}/SUBMISSION-EMAIL.txt` and tries
  `mcp__cowork__present_files` with both the zip and the email-body
  file. The absolute zip path stays in the prose (drag-and-drop into a
  third-party mail client can't consume a chat card); the cards are
  supplementary. On miss, prose is unchanged.



Round 3 of the agntux-build improvements plan, driven by a Cowork
dry-run building `agntux-jira`. Six issues — two harness bugs (false
not-found banner, false missing-Chromium probe), two UX gaps (zip in a
dot-folder, manual paste loop in stage 10), two flywheel-shape gaps
(no plugin-onboarding test stage, over-fitted prompt edits). All
addressed without breaking the public surface.

### Added
- **Stage 9.5 — onboarding test + iterate.**
  `references/09a-onboarding-iterate.md` walks the plugin's own
  onboarding flow inline before the first sync run. Captured values
  land under the scratch root
  (`<agntux-root>/.agntux-build/sessions/{session-id}/sync-output/`),
  never the user's real `data/` or `preferences.md`. Skip-path fires
  cleanly for read-only sources with no per-user personalisation
  (one-line announcement, falls through to stage 10). Cap of 2
  iterations on the onboarding prompts themselves; deeper ambiguity
  belongs to the spec/sync stages.
- **Per-handler `fixtures.json` auto-loaded by the test harness.**
  Canonical scaffold ships
  `canonical/ui-handlers/_template/fixtures.json` next to each
  handler. The harness CLI accepts `--fixture <path|name>` and
  auto-discovers `<plugin>/ui-handlers/<handler>/fixtures.json` when
  neither `--args` nor `--fixture` is passed. Bare names resolve
  under `<handler>/fixtures/` (matching existing TESTING.md
  conventions). Args precedence: `--args` > `--fixture` > nearest
  `fixtures.json` > `{}`. The harness output line now reports the
  args source so the contributor sees where the test data came from.
- **Empty-args self-doc hint in the headless renderer.** When the
  view tool's required-id validation fires AND no args source was
  applied upstream, `host-bridge-entry.mjs` sets
  `window.__agntuxEmptyArgsHint`, the playwright driver propagates
  it through the result envelope, and the harness CLI prints it as
  `hint: …`. The gating predicate
  (`host-renderer/src/empty-args-hint.mjs::shouldShowEmptyArgsHint`)
  is factored out as a pure function with vitest coverage so the
  most subtle logic in the args-source chain isn't browser-only.
  An `argsExplicit` flag threads from the CLI through render.mjs →
  server.mjs → playwright-driver to the host page so a fixture
  whose args resolve to `{}` on purpose (empty-state regression
  tests) doesn't trip the hint.
- **Generalization checklist for stage-10 prompt edits.** New
  load-bearing section in `references/10-sync-iterate.md`: 4
  questions and a rule of thumb that catch over-fitting to one
  user's data before the edit lands. The same checklist is
  cross-referenced from stage 9.5's onboarding edits.
- **`extractChromium(mod)` helper** on
  `test-harness/src/probe-chromium.mjs`. Reads chromium from both
  ESM-native and CJS-wrapped imports
  (`mod.chromium ?? mod.default?.chromium`). Test coverage for
  ESM, CJS-wrap, top-level-prefers-nested, and nullish shapes.
- `test-harness/src/load-fixture.mjs` — fixture resolution helper
  with full vitest coverage for tool-name → handler inference,
  bare-name lookup, malformed-fixture errors, and the precedence
  rules. Auto-discovered fixtures that fail to parse fall back to
  `{}` with a warning (the contributor never asked for that file);
  explicit `--fixture` paths still hard-fail. Bare names without a
  resolvable plugin root or handler-shaped tool name throw rather
  than silently resolving against cwd.

### Changed
- **Stage 10 rewritten for inline sync execution.** The build skill
  now drives sync inline against the rendered sync skill on disk
  (`plugins/agntux-{slug}/skills/agntux-{slug}/{SKILL.md,reference/sync.md,...}`)
  using the source MCP tools that are already authorized in Cowork.
  Sync writes go to the scratch root, not the user's real
  `data/learnings/`. No zip install required for the iteration
  loop. No "reinstall from file" between rounds. Re-render via
  `node scripts/render-skill.mjs agntux-{slug}` is the only step
  between edits and re-run; no MCP-server rebuild because the sync
  skill is pure markdown.
- **Stage 11 takes ownership of the install walk** (the eight-click
  Personal-Plugins flow). It's the first stage that needs a live
  plugin in Cowork (triage UI test). Stage 11 also re-zips into
  Downloads with a bumped patch version so the install reflects the
  iterated prompts from stage 10.
- **Stage 9 demoted to "snapshot in Downloads".** No install walk
  here — that moved to stage 11. The zip is informational at this
  point (the user can see what's been packaged) and gets
  regenerated at stages 11 and 12.
- **Final zip moves from `<agntux-root>/.agntux-build/submissions/`
  to `~/Downloads/`** (cross-platform with explicit resolution
  algorithm: Linux tries `xdg-user-dir DOWNLOAD` first, then falls
  through to `$HOME/Downloads` / `%USERPROFILE%\Downloads`, with a
  final fallback to `$HOME` when no Downloads dir exists — the skill
  doesn't create one). Discoverable for non-technical contributors.
  Session state still lives at `<agntux-root>/.agntux-build/sessions/` —
  only the user-facing zip moved. Stages 11 and 12 fail closed if
  the version embedded in the zip filename didn't bump from the
  saved session state, so a forgotten patch bump can never silently
  overwrite a prior snapshot.
- **SKILL.md routing table** adds row 9.5 between 9 and 10 and
  documents the inline-sync no-install rule on row 10. Saved-state
  schema notes call out the new fields (`onboarding_present`,
  `onboarding_completed`, `onboarding_iterations`,
  `onboarding_capture_path`, `inline_sync_scratch_dir`) and the
  resume-rule that a session interrupted mid-9.5 re-enters at 9.5
  rather than falling forward to 10.

### Fixed
- **`probeChromium` falsely reported the binary missing on CJS
  imports.** Node wraps CommonJS modules in `default` when loaded
  via `await import(absolutePath)`; the previous destructure
  (`({ chromium } = await import(playwrightPath))`) silently
  returned `undefined` and the probe reported "needs install" even
  when the binary was on disk. The new path reads
  `mod.chromium ?? mod.default?.chromium` and fails closed if
  neither yields a chromium with the expected surface. Caught in
  the Cowork dry-run; surfaced because the scratch playwright copy
  shipped CJS.


Round 2 of the agntux-build improvements plan. Five C-tier issues that
the Cowork dry-run surfaced — all converging on "the canonical scaffold
must build cleanly outside AUX-plugins, and the headless test must
actually verify protocol conformance." Internal scaffold + build-pipeline
hardening; no user-visible surface change to the build skill.

### Added
- **`scripts/build-plugin.mjs` build-prep handles two preconditions
  before each component build (plan §C2/C4):**
  - **Packages auto-resolution.** When the canonical scaffold's
    `file:../../../../../packages/agntux-ui-primitives` workspace
    dependency doesn't resolve from the build path (typical when the
    contributor doesn't have AUX-plugins/ cloned and stage 7
    scaffolds into `<agntux project root>/.agntux-build/builds/{id}/`),
    the script symlinks (or copies on EPERM/EXDEV) `packages/` from
    one of three sources in priority order: `AGNTUX_PACKAGES_DIR` env
    var, `<REPO_ROOT>/packages/`, or
    `<CLAUDE_PLUGIN_ROOT>/canonical/packages/`. Fails fast with all
    three candidates listed if none resolve.
  - **Vite → esbuild fallback chain.** If the component build's
    stdout/stderr matches an architectural-crash signature
    (`SIGBUS`, `SIGSEGV`, `Bus error`, `Segmentation fault`,
    `core dumped` — aarch64 Linux is the canonical host; both
    `@vitejs/plugin-react` and `-swc` crash there on larger
    components), the script falls back to direct `esbuild` with the
    canonical flag set (`jsx=automatic`, `target=es2022`,
    `format=esm`, react/react-dom aliased, `tailwindcss` external)
    and wraps the output bundle into `out/index.html`. Real build
    errors (TypeScript, missing imports) propagate without
    triggering the fallback so the contributor sees the actual cause.
  - Build output streams live to the user via a buffered tee — the
    user keeps seeing progress on long builds while the script also
    captures the full transcript for crash-signature sniffing.
- **Locale stubs ship in the canonical template (plan §C3).** The
  scaffold's `use-translation.ts` static-imports 11 locale files
  (`en-US`, `es-ES`, `es-MX`, `fr-FR`, `de-DE`, `ja-JP`, `zh-CN`,
  `pt-BR`, `it-IT`, `ko-KR`, `ru-RU`); all 11 are now present in
  `plugins/agntux-build/canonical/ui-handlers/_template/component/locales/`
  (10 are `en-US.json` copies awaiting real translations). Fresh
  scaffolds get every locale Vite expects from the moment
  `manifest-author` copies the template. Plugin authors who
  customise the hook to import only what they ship (e.g.,
  `agntux-slack`'s `compose` handler) are unaffected — the build
  script does no runtime locale stubbing, so existing trees aren't
  modified silently.
- `canonical/ui-handlers/_template/component/src/__tests__/lib/mcp-adapter.test.ts`
  gains two cases asserting `_isError` preservation on error envelopes
  and absence on normal payloads.

### Changed
- **Replaced hand-rolled `host-bridge.mjs` with the canonical `AppBridge`
  + `PostMessageTransport`** from `@modelcontextprotocol/ext-apps@1.7.x`
  (plan §C1). The previous hand-roll had five separate divergences
  from the wire protocol — wrong sandbox-resource-ready namespace,
  missing `jsonrpc: "2.0"` envelope on outbound notifications, no
  `ui/initialize` request/response handshake, wrong tool-result
  method name, and a one-way sandbox.html pipe. Each one was
  independently fatal: the inner React iframe stayed in its loading
  skeleton forever even on protocol-conformant components. Switching
  to the canonical bridge removes the entire class of drift in one
  move.
  - New: `host-renderer/src/host-bridge-entry.mjs` (source) +
    `scripts/bundle-host-bridge.mjs` (esbuild driver). Install
    regenerates `public/host-bridge.mjs` (now a build artifact;
    `.gitignore`d) via the package's `prepare` script.
  - `public/sandbox.html` accepts the canonical
    `ui/notifications/sandbox-resource-ready` method name (was
    `ui/sandbox/resource-ready`) and emits a `jsonrpc: "2.0"`-tagged
    `ui/notifications/sandbox-proxy-ready` notification with `params:
    {}` (was missing both the version field and params, which made
    the canonical `JSONRPCMessageSchema.safeParse` silently drop it).
  - The "client-side stays hand-rolled" rule now applies to the
    component bundle ONLY (production CSP, `unsafe-eval` forbidden);
    the dev-only host page has no CSP constraint and ext-apps@1.7.x
    ships in jitless Zod mode anyway. README documents the split.
  - Critical ordering invariant: `bridge.connect(transport)` BEFORE
    `iframe.src = "/sandbox.html?…"`. Documented in the entry file's
    header comment AND in the host-renderer README so the next person
    who touches it doesn't reintroduce the deaf-listener race.
- **`LicenseErrorScreen` renamed to `ServerErrorScreen`** in
  `@agntux/ui-primitives` (plan §C5). The component was always a
  generic multi-paragraph error renderer; the name was load-bearing
  only for the now-deleted gate. New name matches what it does —
  surface any `isError: true` envelope from `tools/call` (rate limit,
  auth failure, upstream 5xx). All four shipped plugin handlers
  (slack canvas/compose, gmail compose, core triage) and the
  canonical scaffold now import `ServerErrorScreen`.
- **`extractToolOutput` preserves `_isError`** in the canonical
  apps-client mcp adapter. `detectErrorEnvelope` now reads the
  preserved flag as the precise path; the legacy
  absence-of-payload-keys heuristic is the fallback for adapters that
  strip `isError`. An explicit `_isError: false` always returns null
  (regression-guarded by a new test) so callers never mis-surface a
  normal payload as an error.
- **`07-build.md`** gains a "Build-prep the contributor never sees"
  section documenting the C2/C3/C4 contract between the skill and the
  marketplace's build pipeline (`scripts/build-plugin.mjs`).
- Stale "license enforcement is in the MCP server via
  `@agntux/mcp-license`" prose updated across `invariant-checker.md`,
  `release-checker.md`, `tests-author.md`, the
  cold-start / skills-structure tests, and `CONTRIBUTING.md`. Plugins
  are Apache-2.0 and unconditionally free; no MCP-server license
  gate exists.

### Removed
- **`<LicenseGate>` purged from the canonical UI handler scaffold
  (plan §C5).** The relicensing PR (`009d125`) removed the
  server-side license gate but left the iframe-side render-token gate
  in the template; every newly scaffolded plugin's `App.tsx`
  re-imported it. Deleted:
  `canonical/.../components/license-gate.tsx`,
  `canonical/.../lib/license.ts`, the matching test, and the
  `<LicenseGate>` wrapper around `<MainComponent>`. New scaffolds
  render `MainComponent` directly inside `<ComponentErrorBoundary>`.
- Orphan `__tests__/lib/license.test.ts` removed.
- `canonical/hooks/test/fixtures/test-key.mjs` removed (the JWT signing
  helper for the now-deleted server-side gate).
- Dead `license.*` keys removed from canonical `en-US.json` (paired
  with the C5 purge).

### Fixed
- `plugins/agntux-core/e2e/smoke.test.mjs` was reading the deleted
  `agents/pattern-feedback.md`; now reads
  `skills/agntux/reference/feedback-review.md` (where the body lives
  post the 8.0.0 single-skill consolidation). Two formerly-failing
  tests now pass.

## [0.1.1] — 2026-05-10

Tightens the build skill's voice, scopes the marketplace search,
biases toward comprehensive in-host action coverage, and lets the
build/test stages self-fix without pausing for the contributor.
Also lifts a static-route gate that blocked headless mode and adds
a content-rubric and prepare-scratch path to the test harness.

### Changed
- **Search scopes to AgntUX only.** Stage 1 reads
  `marketplace/index.json` (local clone if present, otherwise the
  CI-published GitHub raw URL via `WebFetch`) and never touches the
  host's full plugin universe. Earlier behaviour returned false
  negatives ("no AgntUX plugin") when a non-AgntUX plugin with the
  same name existed in another marketplace.
- **Stage 4 / 5 default to comprehensive write-verb coverage.** A
  Jira-class connector now ships 4–5 in-host action handlers
  (comment, transition, assign, edit, set priority) by default; the
  prior "one primary write verb" cap is gone. Two verbs collapse to
  tabs only when their *inputs* collapse.
- **"Open in {connector}" is always secondary.** Re-stated as the
  iframe-header `Open ↗` link, never a top-level suggested-action
  button. AgntUX's suggested-action UX stays one-button-per-action;
  no "more" / overflow menus.
- **Stage 7 specialist failures self-fix silently.** The user no
  longer sees "want me to retry?" prompts. On second failure, an
  Opus-tier executor takes a third pass; only after a third miss
  does the user see a one-line save-the-session message.
- **Stage 7 → 8 transition is automatic.** No "ready to install?"
  confirmation gate before the render check.
- **Stage 8 self-fixes silently.** Console errors and render-state
  drift dispatch the executor (sonnet → opus) up to three times
  before surfacing anything; no inline screenshot until stage 11.
- **Stage 9 explicitly names the first user pause.** A header
  sentence makes the contract clear: stages 1–8 ran without
  pausing, this is the install step.
- **Stage 10 sync-iterate copy drops "Show more".** AgntUX action
  items don't have a "show more" affordance under the
  one-button-per-action rule.
- **Stage 12 wrap-up is non-technical.** The closing message no
  longer enumerates files in the zip, specialists that ran, or
  schema keys; full detail lives in the session JSON for
  maintainers.
- Field renamed: `primary_write_verb` (scalar) →
  `primary_write_verbs` (array). Read-only sources save `[]`.

### Added
- **`probe-chromium` subcommand** on
  `test-harness/bin/cli.mjs`. Resolves Playwright via the
  host-renderer workspace and stat-checks
  `chromium.executablePath()`. Prints
  `{installed, executablePath?, reason?}` and exits 0 (installed)
  or 1 (not installed / import failed). Used by the stage 8
  Chromium-auto-install flow. Module
  (`test-harness/src/probe-chromium.mjs`) ships with vitest
  coverage matching the rest of `test-harness/__tests__/`.
- **Content-rubric checks** in `playwright-driver.mjs`. After
  `state=tool-result`, the harness now runs per-tool DOM
  assertions (`CONTENT_RULES`) verifying the rendered iframe
  contains the source-side context (issue key, draft body,
  verb-labelled button). Failures surface as
  `contentChecks.failed[]` in the harness JSON output and
  fail the render.

### Skill-prompt instructions (no code yet)
- **Stage 7.5 invariant gates** before the render run: tsc
  compile, no-boilerplate, embed-pass, `_meta.ui.resourceUri`
  shape. The orchestrator dispatches `executor` on miss with the
  same self-fix cadence as stage 7.
- **Chromium auto-install** in stage 8. The orchestrator runs
  `probe-chromium` first; on miss, runs
  `playwright install chromium` and surfaces a single one-time
  setup status line, then continues.
- **Read-only-host fallback** in stage 8. The orchestrator copies
  `host-renderer/` and `test-harness/` to a writable scratch dir
  on read-only mounts (Cowork sandbox, Claude Desktop plugin
  mount) and points the harness at it via `--host-bin`. Internal
  prepare-scratch in the harness itself is a follow-up.

### Fixed
- `host-renderer/src/server.mjs` served `host.html` and
  `host-bridge.mjs` only outside `--headless` mode, so every
  Playwright run 404'd on the host page. Both routes are now
  unconditional.

## [0.1.0] — 2026-05-08

Initial release. The user-facing front door for the
end-user-as-contributor flywheel — a one-click marketplace install that
walks a knowledge worker through building a brand-new AgntUX plugin
without ever surfacing engineering jargon.

### Added
- `/agntux-build:build` orchestrator skill with stages 0–12 (identity +
  Developer Certificate of Origin capture, marketplace search, install
  or improve, connector authorisation, tools discovery, write-back UI
  planning, design + preview, build, headless test, zip + install
  handoff, sync iteration, triage UI test, submit).
- Eight internal specialist agents lifted from `agntux-plugin-dev`'s
  `plugin-toolkit` (manifest, ingest-prompt, source-semantics,
  draft-flow, tests, invariant-checker, release-checker,
  ui-handler-author). Hidden from user-facing copy — agent names never
  surface in chat.
- Canonical UI authoring knowledge layer (17 modules) and the React +
  Vite UI handler `_template/` scaffold under `canonical/`.
- Lightweight in-plugin MCP App host renderer under `host-renderer/`,
  forked from `modelcontextprotocol/ext-apps/examples/basic-host` (MIT)
  with a headless mode and a plugin MCP bridge — no MCPJam Inspector
  required.
- `agntux-build-test` CLI under `test-harness/` for headless
  Playwright-driven render checks against the in-plugin host.
- Identity + DCO capture flow at first run: stores
  `<agntux project root>/.agntux-build/contributor.json` with name,
  email, DCO version, and timestamp; embeds a per-zip
  `CONTRIBUTING-SIGNATURE.md` carrying the `Signed-off-by:` trailer
  Probot DCO accepts.

### Voice
- Knowledge-worker tone end-to-end. No "schema", "dispatch",
  "render pipeline", "byte-freeze", "validator" or other internal
  terms surface in chat. Stage transitions are silent.
- Light-mode-only design rules; deviations redirect to
  `https://github.com/AgntUX/AUX-plugins/issues` rather than relenting.
- Gratitude at every milestone. The 3–5-iteration sync loop is set as
  the expected norm rather than a failure mode.
