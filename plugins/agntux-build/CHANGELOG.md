# Changelog

All notable changes to agntux-build are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] — 2026-05-10

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
