# CLAUDE.md — AgntUX/AUX-plugins

This is the public AgntUX plugin marketplace. Every plugin in `plugins/` is a
host plugin distributed via `.claude-plugin/marketplace.json` at the repo root.

---

## AgntUX Project Root

User data lives in **any directory named `agntux`** (case-insensitive). At
runtime, hooks and MCP servers resolve the project root by:

1. Walking up from the host's `process.cwd()` for the nearest ancestor whose
   lowercased basename is `agntux`.
2. Falling back to `<home>/agntux` if no walk-up match.
3. Returning null (hooks passthrough) or a best-guess path (MCP guards) if
   neither exists.

The single resolver is `canonical/hooks/lib/agntux-root.mjs`
(`resolveAgntuxRoot()`); the orchestrator MCP server has a TS twin at
`canonical/mcp-server-templates/orchestrator/src/agntux-root.ts`. **Never
hardcode `~/agntux-code/` or `homedir() + "agntux"` in new code** — always
go through the resolver. Prompts and docs that need to reference the path
should write `<agntux project root>/...` (or `<root>/...` once defined in
the prompt).

---

## Repo Layout

```
AgntUX/AUX-plugins/
├── .claude-plugin/marketplace.json    # Plugin index for the host's marketplace mechanism (CI-regenerated)
├── .claude/                           # Maintainer slash commands and skills
├── canonical/                         # Prompt templates + MCP server templates (no byte-frozen hooks)
├── packages/agntux-ui-primitives/     # Shared React primitives consumed by every UI handler
├── marketplace/index.json             # CI-regenerated aggregate of every listing.yaml (READ-ONLY)
├── plugins/{plugin-slug}/             # One directory per plugin
├── scripts/                           # Lint, regeneration, and build-orchestration scripts
└── CLAUDE.md                          # This file
```

---

## Schema Evolution — Additive-Only Policy (P7)

The on-disk schemas under `<agntux project root>/data/schema/` (personal)
and `<agntux project root>/teams/{team-slug}/data/schema/` (per-team)
evolve via **additive-only** semver bumps. Ratified in P7 of the AgntUX
Teams master plan; load-bearing for every plugin in this repo that
reads, writes, or validates entity/action files.

The rules:

- **MINOR** (`1.0.0 → 1.1.0`) — additive changes: new optional field,
  new subtype, new action_class, **or promoting a previously-optional
  field to required so long as legacy files self-heal via the
  hook+runbook loop**. Existing files at the older version remain
  valid (contract-ahead MINOR drift passes silently); the next touch
  picks up the new shape additively.
- **PATCH** (`1.1.0 → 1.1.1`) — no-surface clarifications. No data
  impact.
- **MAJOR** is **forbidden by policy.** Breaking changes (removing a
  required field, renaming, narrowing a type, dropping a subtype) MUST
  be rewritten as additive deprecations at the authoring layer:
  `/agntux schema` (personal) and `/agntux-teams onboard:team-lead`
  (per-team) reject MAJOR proposals and offer the additive rewrite
  (deprecate the old field; add a new one; consumers tolerate both
  during the transition). Users never have to manually run a
  migration; the on-disk corpus is never rewritten in bulk.

The validator hook (`plugins/agntux-core/hooks/validate-schema.mjs`)
enforces this at write time:

- File ahead of contract by MINOR → reject + emit the bump runbook
  (Edit operations the agent executes to advance the contract + lock,
  then retry).
- Contract ahead of file by MINOR → pass silently (legacy file shape).
- MAJOR drift either direction → reject. (Should never appear in
  practice because the authoring layer guards against it; the
  hook-level rejection is a backstop.)
- PATCH drift either direction → pass silently.

Hook-computed identifiers like `entity_id` follow the same self-heal
shape: the hook rejects writes with missing or wrong values and bakes
the correct value into the rejection runbook. **The LLM never computes
hashes** — see `canonical/hooks/lib/entity-id.mjs` for the canonical
helper, byte-frozen into every plugin's `hooks/lib/` that needs it.

## License — Apache 2.0

All plugins and shared packages are licensed under the **Apache License
2.0**. See the root `LICENSE` and `NOTICE`. Solo use is unconditionally
free — no license-key gate lives in any plugin. Sync, cross-team rollup,
and the private team marketplace are part of the separate proprietary
AgntUX Teams product.

---

## When You Edit a Plugin

Every plugin under `plugins/{plugin-slug}/` MUST ship the following files
(see P15 §2 for the full specification):

- `.claude-plugin/plugin.json` — the host's plugin manifest. Aligned with the
  host's spec, plus exactly one runtime-only custom field
  (`recommended_ingest_cadence`, §2.5.1). Do NOT add other custom fields.
- `LICENSE` — Apache License 2.0 (full text). Mirrors the root `LICENSE`.
- `hooks/` (optional) — plugin-author-defined Claude Code hooks.
  agntux-core uses hooks for schema and index validation; agntux-slack
  and agntux-gmail ship no hooks.
- `marketplace/listing.yaml` — structured marketplace metadata. **Required.**
- `marketplace/icon.png` — 512×512 PNG, ≤ 512 KB.
- `marketplace/screenshots/NN-name.{png,jpg}` — 1–8 screenshots.
- `README.md` — one-screen explainer; doubles as the listing detail body
  rendered on agntux.ai/plugins/{slug}.
- `CHANGELOG.md` — Keep-a-Changelog v1.1.0 format. Most-recent version section
  MUST match `plugin.json`'s `version` field.

---

## Authoring Rules

- **Plugin manifest stays minimal.** Don't add fields to `plugin.json` beyond
  the host's documented spec, with one explicit exception:
  `recommended_ingest_cadence` (§2.5.1). Marketplace display metadata goes in
  `listing.yaml` only.
- **Field ownership — never duplicate across files.** Per Claude Code's
  marketplace docs, `plugin.json`'s value wins silently for any field that
  appears in both `plugin.json` and the `marketplace.json` plugin entry, so
  duplicates can only mislead. The split:
  - `plugin.json` owns: `name`, `version`, `description`, `author`,
    `license` (use SPDX `Apache-2.0`), plus `recommended_ingest_cadence`.
  - `.claude-plugin/marketplace.json` plugin entries own only what is **not**
    in `plugin.json`: `name`, `source`, `homepage`, `keywords`, `category`.
    Regenerated by `scripts/regenerate-marketplace-json.ts`.
  - `listing.yaml` owns AgntUX-website-only fields: `tagline`,
    `supported_prompts`, `ui_components`, `screenshot_order`, `categories`,
    `keywords`, `developer`, `support`, etc.
- **Contributor attribution by GitHub username.** `developer.github_handle` is
  the canonical identity in `listing.yaml`. The website renders `@{handle}`
  linking to `https://github.com/{handle}`.
- **`tagline` is plain text; `description` and `purpose` fields support
  markdown.** Don't author HTML tags — they get escaped.
- **`recommended_ingest_cadence` lives in `plugin.json` only** — never in
  `listing.yaml`. P4's personalization subagent reads it from there at runtime.
- **CHANGELOG version MUST match `plugin.json` version.** The linter rejects
  mismatches.
- **Screenshots are listing collateral, NOT functional UI.** Real UI bundles are
  served from S3 with signed URLs (P2 §11).
- **`dist/` and `out/` are tracked artifacts, not source.** Plugins ship
  compiled output in the repo so consumers get a runnable plugin at the
  pinned SHA with no host-side install step. The tracked set depends on the
  plugin's kind (predicate: presence-of-`mcp-server/`-directory; same one
  used by `scripts/build-plugin.mjs`, `scripts/regenerate-marketplace-json.ts`,
  and `.github/workflows/build-plugins.yml`):
  - **Local-server plugins** (have `mcp-server/`, e.g. `agntux-build`,
    `plugin-toolkit`) track `plugins/*/mcp-server/dist/` plus
    `plugins/*/ui-handlers/*/component/out/` for the embedded UI bundles.
    The Claude Code host launches `mcp-server/dist/index.js` directly.
  - **Source plugins** (no `mcp-server/`; have `view-tool/` only, e.g.
    `agntux-slack`, `agntux-gmail`) track `plugins/*/view-tool/dist/` —
    `<slug>-view.js`, `view-tools.manifest.json`, and
    `ui-resources/*.html`. These are served by the remote MCP server in
    `app/` via the plugin registry; no local launch happens. Their
    `marketplace.json` entry carries `kind: "remote-view-only"` so the
    host knows to skip local-launch for them.
  - **Hybrid plugins** (have both, e.g. `agntux-core`) track both sets.
  - `packages/*/dist/` is also tracked for shared workspace packages.

  CI (`build-plugins.yml`) rebuilds the appropriate set per plugin on push
  to `main` and commits the regenerated tree back. **Do not hand-edit** any
  file under `plugins/*/mcp-server/dist/`,
  `plugins/*/ui-handlers/*/component/out/`, `plugins/*/view-tool/dist/`,
  or `packages/*/dist/` — your edit will be overwritten on the next merge.
  Edit the source under `src/` and run `node scripts/build-plugin.mjs
  {slug}` (or `/dev-plugin {slug}` for local-server plugins) to regenerate.
- **View-tool bundles inline their own CSS.** The iframe loads ONLY the
  inlined HTML resource — external stylesheets are never fetched and
  `vite-plugin-singlefile` does not emit any external assets. Author
  styles via Tailwind utility classes in `view-tool/src/*-ui.tsx` only
  when the view-tool also wires the Tailwind CSS pipeline into Vite:
  add `tailwindcss` + `@tailwindcss/vite` to `view-tool/package.json`
  devDeps, register `tailwindcss()` in `view-tool/vite.config.ts`,
  create `view-tool/src/globals.css` with `@import "tailwindcss";`,
  and `import "./globals.css";` at the top of every `*-ui.tsx`. The
  pass-13 marketplace linter (E28) enforces a non-empty inline
  `<style>` block in every emitted HTML resource when the source
  references `className=`.
- **We do NOT use `@modelcontextprotocol/ext-apps` (the official MCP Apps
  SDK).** Servers depend only on core `@modelcontextprotocol/sdk` and
  hand-roll the Apps surface (`_meta.ui.resourceUri` on tools, `ui://...`
  resources from base64-embedded bundles). UI handlers use a custom
  `SimpleMcpApp` (~250 lines) that speaks the postMessage protocol
  directly. Two reasons, both load-bearing: (1) MCPJam Inspector and other
  strict hosts forbid `unsafe-eval`, and `ext-apps` ships Zod which
  JIT-compiles via `eval`; (2) the spec explicitly permits direct
  postMessage implementations ("The App class is a convenience wrapper,
  not a requirement"). Full rationale lives at
  `plugins/agntux-slack/ui-handlers/compose/component/src/lib/README.md`.
  Revisit only if the upstream ships an eval-free build.

---

## Authoring sync skills

Every ingest plugin (`agntux-slack`, `agntux-gmail`, and any future
source) ships a `skills/{plugin-slug}/SKILL.md` that the host loads as
the `/{plugin-slug}` slash command. The skill `name:` matches the
plugin slug; the SKILL.md is a slim router (~80 lines) and the
procedural body lives under `reference/`. **These files are rendered,
not hand-edited.** The single source of truth is
`canonical/prompts/ingest/skills/sync/` (the canonical parent
directory keeps the `sync/` name because it's internal-only):

```
canonical/prompts/ingest/skills/sync/
├── SKILL.md                           # canonical router (~80 lines)
│                                      # with {{placeholders}}
├── STUBS.md                           # documents every placeholder
└── reference/
    ├── sync.md                        # procedural body (steps 0–11 +
    │                                  # preflight + orchestrator gate)
    │                                  # carries <!-- append:* --> markers
    ├── ask.md                         # natural-language live-query handler
    │                                  # (read-only)
    ├── fetch.md                       # generic fetch skeleton (overridable)
    ├── compose-payload.md             # generic schema (overridable)
    ├── cursor.md                      # generic cursor reference
    ├── runbook.md                     # generic failure-mode taxonomy
    ├── deep-links.md                  # stub (overridable)
    └── honesty.md                     # honesty rules + append marker
```

Per-plugin overrides live at `plugins/{slug}/skills/{slug}/_overrides/`:

- `frontmatter.yaml` — required. Substitution values for canonical
  `{{placeholders}}` (including `plugin-slug`, `plugin-version`,
  `source-display-name`, `source-slug`, `source-mcp-tools`,
  `source-cursor-semantics`, `thread-unit-name`,
  `bootstrap-window-default-days`, `example-channel`).
- `{step-id}-append.md` — zero or more. Spliced verbatim at canonical
  `<!-- append:{step-id} -->` markers (in SKILL.md AND every
  `reference/*.md`), then the marker is stripped.
- `reference/{name}.md` — zero or more. Replaces the canonical
  `reference/{name}.md` wholesale (substitution still applies).
  Per-plugin extras (no canonical counterpart) pass through verbatim.

`scripts/render-skill.mjs {slug}` reads canonical + `_overrides/` and
writes `plugins/{slug}/skills/{slug}/{SKILL.md, reference/*.md}`. The
renderer is also invoked automatically by `scripts/build-plugin.mjs`
between the UI component build and the mcp-server build, so a routine
`node scripts/build-plugin.mjs {slug}` always re-renders the tree
before embedding it.

The first whitespace-delimited `$ARGUMENTS` token selects the
sub-command at runtime: empty or `sync` runs the ingest pass
(`reference/sync.md`); anything else is treated as a live
natural-language query (`reference/ask.md`, read-only — no cursor
advance, no knowledge-store write).

**Lint pass 8 is mandatory.** Every plugin with
`skills/{plugin-slug}/SKILL.md` MUST ship `_overrides/frontmatter.yaml`,
the rendered tree must be byte-identical to what the renderer
produces, no `{{placeholders}}` may survive in committed output,
`SKILL.md` must be ≤ 500 lines (router shape — typically ≤ 100),
`reference/sync.md` must be ≤ 600 lines (the canonical procedural body is
~469 lines and needs headroom for a plugin's source-specific splices),
every other sibling under `reference/` must be ≤ 500 lines (detail-shape
siblings are smaller), and links must stay one level deep — references reach siblings by
prose name (e.g., "the cursor reference shape"), not by markdown link.
Edits to the rendered `SKILL.md` are detected by the drift check and
fail CI — edit the override or the canonical instead.

A new ingest plugin's day-one authoring work is a `frontmatter.yaml`
plus a source-specific `_overrides/reference/fetch.md`. Everything
else can stay canonical.

---

## How to Validate Locally

```bash
npm install
npm run lint:marketplace                             # Lint every plugin
npm run lint:marketplace -- --plugin agntux-slack    # Lint one plugin
```

The linter is the same script CI runs. Local-passing means CI-passing.

Passes that catch user-visible breakage (not exhaustive):

| Pass | Codes | What it catches |
|---|---|---|
| 1 | E01 | Required files (`plugin.json`, `LICENSE`, `README.md`, `CHANGELOG.md`, listing) |
| 2 | E02–E12 | listing.yaml schema, version-CHANGELOG match, plugin.json shape |
| 3 | — | Icon dimensions, screenshot dimensions / size |
| 4 | — | README/CHANGELOG shape |
| 7 | E13 | No third-party MCP calls from view tools |
| 8 | — | Sync-skill render drift + skill line-budget |
| 9 | E20–E22 | **Zip-upload safety**: forbidden filename chars (`{ } : ? * < > \| "` + control chars), reserved plugin-name prefixes (`claude-`, `anthropic-`), non-ASCII filenames (warning) |
| 10 | E23 | **View-tool bundles are real HTML**: every `plugins/*/view-tool/dist/ui-resources/*.html` must begin with HTML markup (`<!doctype` / `<html`), not a raw JS module renamed to `.html`. Catches misconfigured Vite inputs that ship `mimeType: "text/html"` resources containing a JS bundle — Claude Cowork and MCPJam reject those with "Unsupported UI resource content format". Fix is to point Vite's `rollupOptions.input` at a sibling HTML file that imports the `.tsx` via `<script type="module">` (canonical shape: `plugins/agntux-core/view-tool/triage.html` + `vite.config.ts`; template: `plugins/agntux-build/canonical/ui-handlers/_template/view-tool/`). |
| 11 | E24, E25 (warning) | **View-tool payload-shape regression guard**: every plugin that ships `view-tool/` MUST also ship `view-tool/__tests__/payload-shape.test.ts` containing both a byte-length builder (`Buffer.byteLength` or `JSON.stringify`) AND a `.toBeLessThan` matcher. Catches the agntux-core 9.5.3 bug class — `structuredContent` that exceeds the host's ~64 KB max-tokens cap on saturated workspaces, silently breaking iframe rendering. E24 = test file missing; E25 = file exists but has no size assertion. Both are **warnings** (not errors) for now so existing plugins without the test don't break CI; promote to error once every plugin ships the file. Scaffold at `plugins/agntux-build/canonical/ui-handlers/_template/view-tool/__tests__/payload-shape.test.ts` — copy and tune `KEPT_KEYS` + `PAYLOAD_BUDGET_BYTES` per plugin. |
| 12 | E26 (error), E27 (warning) | **Vendored apps-client byte-equality**: every vendored copy of `simple-mcp-app.ts` and `constants.ts` under `plugins/*/view-tool/src/lib/apps-client/` and `plugins/agntux-build/canonical/ui-handlers/_template/{view-tool,component}/src/lib/apps-client/` MUST be byte-identical to the canonical at `plugins/agntux-core/ui-handlers/triage/component/src/lib/apps-client/`. Catches the silent-regression class where a future bugfix lands in one copy but not the others — the affected plugin's iframe would stay on "Loading…" forever (the 9.5.4 bug class) while the others work fine. E26 = sha256 mismatch (re-copy from canonical or update the canonical first); E27 = vendored file missing. The canonical itself is never linted (it IS the source). |
| 13 | E28 (warning) | **View-tool CSS bundle present**: every plugin whose `view-tool/src/*-ui.tsx` references `className=` MUST emit `view-tool/dist/ui-resources/*.html` resources that contain a non-empty inline `<style>` block. Catches the agntux-core 9.5.7-class bug where the iframe renders as unstyled HTML because Vite never built any CSS at all (Tailwind utility classes were used in the JSX but `@tailwindcss/vite` was not wired up, so the rendered output looked like a raw text dump). Fix: add `@tailwindcss/vite` + `tailwindcss` to view-tool devDeps, register the plugin in `view-tool/vite.config.ts`, create `view-tool/src/globals.css` with `@import "tailwindcss";`, and `import "./globals.css";` at the top of every `*-ui.tsx` entry. Canonical shape: `plugins/agntux-build/canonical/ui-handlers/_template/view-tool/`. Warning-only for now; promote to error once every plugin ships the fix. |

Pass 9 catches the Claude Desktop upload rules at PR time so plugins don't
make it to the upload UI just to be rejected there. The same scan runs
defensively in `scripts/package-plugins.mjs` so a synthesised zip can't
ship a bad path either. If you need a placeholder in a scaffold-template
filename, use the `__placeholder__` convention (see
`plugins/agntux-build/canonical/ui-handlers/_template/README.md`) — file
**contents** can still use `{{placeholder}}` since those aren't
zip-validated.

---

## Local Plugin Development

When the user asks to build a plugin's components and/or run its MCP server
locally for testing, use the commands below. Don't reach for the manual
`cd ui-handlers/<name>/component && npm run build` chain — that's the legacy
flow and is easy to get wrong (it's per-handler, so a multi-handler plugin
like agntux-slack needs the chain repeated for every handler).

`scripts/build-plugin.mjs` is the single entry point — it accepts one or
more slugs, with optional `--serve` to launch each plugin's MCP server in
HTTP_MODE after the build. Each plugin's MCP server has its own default
port (agntux-core=5170, agntux-slack=5180), so multi-plugin `--serve`
doesn't need port flags.

| Request phrasing                                                                          | Command                                                                |
|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------|
| "build {slug}" / "build the {slug} component(s)"                                          | `node scripts/build-plugin.mjs {slug}`                                 |
| "build {slug1} and {slug2}"                                                               | `node scripts/build-plugin.mjs {slug1} {slug2}`                        |
| "build all plugins"                                                                       | `node scripts/build-plugin.mjs --all`                                  |
| "run {slug} for local testing" / "start {slug}" / "build and run {slug}"                  | `node scripts/build-plugin.mjs {slug} --serve`                         |
| "build the plugins and start the MCP servers for {slug1} and {slug2}" / "run X and Y together" | `node scripts/build-plugin.mjs {slug1} {slug2} --serve`            |
| "build all plugins and serve them"                                                        | `node scripts/build-plugin.mjs --all --serve`                          |
| "verify {slug} bundle is in sync"                                                         | `npm --prefix plugins/{slug}/mcp-server run check:bundle-sync`         |

`build-plugin.mjs` builds every UI handler component, builds the
mcp-server (which embeds the components), runs `check:bundle-sync`, and —
with `--serve` — launches the MCP server(s) in HTTP_MODE so a separately-
running MCPJam Inspector can connect.

When `--serve` is given multiple slugs, each server's stdout/stderr is
prefixed with `[{slug}]` and Ctrl-C tears all of them down.

The legacy per-plugin shortcut `cd plugins/{slug} && npm run dev` still
works for the single-plugin case (it delegates to `build-plugin.mjs`),
but prefer the top-level command above so multi-plugin and single-plugin
phrasings route the same way.

**Workspace note.** Each plugin's root `package.json` declares its UI
components and `mcp-server/` as npm workspaces. `build-plugin.mjs`
auto-detects this and runs ONE `npm install` at the plugin root rather
than per-member, because npm 10.9+ crashes
(`Cannot read properties of null (reading 'package')`) if you run
`npm install` inside a workspace member. CI keeps using `--skip-install`
unchanged.

MCPJam Inspector is a separate process. The user runs it themselves in a
different terminal (typically `npm --prefix /path/to/MCPJam-inspector run dev`).
Don't try to launch MCPJam from this repo — we don't bundle it.

**MCPJam handoff URL.** Once the Inspector is running on port 5173 and
the plugin servers are up, hand the user a single deep-link that
pre-attaches every running server. Base is the Inspector's app-builder
view; each server is a repeated `mcpServerUrl` query param holding the
URL-encoded `http://127.0.0.1:<port>/mcp`:

```
http://127.0.0.1:5173/?mcpServerUrl=<encoded-mcp-url>&mcpServerUrl=<encoded-mcp-url>...#app-builder
```

Default ports: agntux-core=5170, agntux-slack=5180, agntux-gmail=5190.
The full three-server URL is therefore:

```
http://127.0.0.1:5173/?mcpServerUrl=http%3A%2F%2F127.0.0.1%3A5170%2Fmcp&mcpServerUrl=http%3A%2F%2F127.0.0.1%3A5180%2Fmcp&mcpServerUrl=http%3A%2F%2F127.0.0.1%3A5190%2Fmcp#app-builder
```

Drop the `mcpServerUrl=...&` segments for any plugin that isn't being
served, and keep the `#app-builder` fragment — it's what routes the
Inspector to the right view.

The `/dev-plugin {slug}` slash command is the same as `npm run dev` from
the plugin directory; use whichever the user reaches for.

---

## How to Update a Listing

1. Edit `plugins/{plugin-slug}/marketplace/listing.yaml` (or any other
   `marketplace/`, `README.md`, or `CHANGELOG.md` file).
2. Push to a branch; open a PR.
3. CI runs the linter. Read the error output and fix any failures.
4. On merge, the aggregate-index regeneration workflow fires; agntux.ai/plugins
   picks up the change within ~5 minutes.

---

## Repo Automation

The `.claude/commands/` directory contains slash commands for common operations:

| Command | Purpose |
|---|---|
| `/add-plugin {slug}` | Manually add a plugin entry to `marketplace.json` |
| `/lint-plugin {slug}` | Lint a plugin's marketplace metadata |
| `/bump-version {slug} {major\|minor\|patch}` | Apply the versioning rubric |
| `/rollback {slug}` | Step through the rollback runbook |
| `/review-pr [PR#]` | Apply the PR review checklist |
| `/dev-plugin {slug}` | Build a plugin's components + mcp-server and run it in HTTP_MODE for local testing |
| `/package-plugins {slug}\|--all` | Build and produce `.zip` archives in `dist-zips/` for manual upload to Claude Desktop (fallback when the marketplace UI is broken) |

### agntux-build toolchain vendoring (`sync:agntux-build-toolchain`)

`agntux-build` is special: it **ships a vendored copy of the build/validate
toolchain inside its own bundle** so a contributor with **no marketplace clone**
can still scaffold, build, and validate a plugin in their sandbox. That creates
two copies of several files — and a strict source-of-truth rule.

- **Source of truth** lives at the repo root: `scripts/` (`validate-plugin.mjs`,
  `build-plugin.mjs`, `render-skill.mjs`, `scaffold-marketplace-assets.mjs`,
  `toolchain-layout.mjs`, `check-view-tool-imports.mjs`,
  `lint-marketplace-metadata.ts`), `canonical/`, and `packages/*/dist`. **Edit
  here.**
- **Derived, tracked copies** live under `plugins/agntux-build/`: `bin/`
  (`validate-plugin.mjs`, `build-plugin.mjs`, `toolchain-layout.mjs`), `scripts/`
  (the helpers + the esbuild-compiled `lint-marketplace-metadata.mjs`), and
  `canonical/` (ingest sync templates, scaffold assets, lifecycle-stripped
  `@agntux/*` package manifests, and the apps-client `repo-mirror`). **Never
  hand-edit a bundled copy** — it will just be overwritten and CI will flag the
  drift.
- **Sync command:** `npm run sync:agntux-build-toolchain` vendors source → bundle.
  `node scripts/sync-agntux-build-toolchain.mjs --check` fails on drift and is
  wired into CI + a vitest (`scripts/sync-agntux-build-toolchain.test.ts`). So the
  workflow when touching the toolchain is always: **edit the repo-root source →
  run the sync → commit both.** `toolchain-layout.mjs` resolves paths for either
  layout (`repo` when run from the root clone, `bundle` when run from
  `$CLAUDE_PLUGIN_ROOT`), so the same scripts work in both.

The **MCP server is separate from this sync.** `plugins/agntux-build/mcp-server/`
is hand-authored: edit `src/`, then run `node plugins/agntux-build/mcp-server/build.js`
to produce `dist/` (a verbatim `src/*.js → dist/*.js` copy — also a tracked
artifact the host launches via `.mcp.json`). The server imports the vendored
`../../bin/validate-plugin.mjs` / `../../scripts/*` at runtime and runs the
deterministic build natively (full fs, real Chromium) where the restricted Bash
sandbox can't. So a toolchain change reaches Cowork via **two** steps: sync the
bundle **and** (if `mcp-server/src` changed) rebuild `dist/`, then repackage the
zip.

## Authoring tools

The `plugin-toolkit` plugin (specialist agents for authoring AgntUX
plugins, plus an MCP App UI test harness) has moved to the
[`agntux-plugin-dev`](https://github.com/AgntUX/agntux-plugin-dev)
marketplace. Install via `/plugin marketplace add
https://github.com/AgntUX/agntux-plugin-dev` then `/plugin install
plugin-toolkit@agntux-plugin-dev`.

---

## PR Review Checklist

The canonical checklist lives in [`CONTRIBUTING.md`](CONTRIBUTING.md#pr-review-checklist) — apply it on every plugin PR (also runnable via `/review-pr`). The semver rubric used by the version-bump bullet:

- MAJOR: breaking change to public surface (prompts users rely on, `ux:` prompts, `requires_source_mcp.connector_slug`, removing a category or `ux_components` entry)
- MINOR: additive non-breaking (new `ux_components`, new `supported_prompts`, new optional field, new screenshot, new category)
- PATCH: no-surface change (copy fix, README typo, screenshot replacement, lint compliance, dependency bump)

---

## Version Tags Are Load-Bearing

Every plugin version is published to consumers via a git tag of shape
`{slug}@{version}` (e.g. `agntux-core@9.5.1`, `agntux-gmail@4.0.2`).
The tag — **not the file in main** — is the contract surface. The
`agntux/app` remote MCP loader's pin-resolver reads the tag to fetch
the matching `view-tool/dist/` bundle; until a tag exists for a given
version, every Claude Desktop / claude.ai client keeps loading the
**previously-tagged** version's bundle, even if `main` has the new
code.

This means **bumping `plugin.json` without landing the commit on main
is a no-op for end users.** Symptom: re-uploading a freshly-built
zip to Claude Desktop doesn't change what the host renders, because
the host resolves the bundle through the remote loader (which is
still pinned to the previous tag). The fingerprint is the served
bundle matching the OLD version's CSP / opener; the local file on
disk is irrelevant.

Tags are pushed **automatically** by `.github/workflows/build-plugins.yml`
on every push to `main`. The workflow's final step
("Tag new plugin versions") iterates every `plugins/*/.claude-plugin/plugin.json`,
checks whether `{slug}@{version}` already exists, and pushes any
missing tags at the same SHA as the freshly-rebuilt `dist/` artifacts
commit. Idempotent — re-running on a SHA whose versions are already
tagged is a no-op.

What this means in practice:

- A version bump merged to main with the workflow enabled tags itself
  on the next CI run. Nothing for the author to do.
- A version bump that **only exists in a local working tree** is
  invisible to clients. If a user reports the previous bundle still
  being served, check `git log origin/main -- plugins/{slug}/.claude-plugin/plugin.json`
  before doing anything else. (Also see CHANGELOG.md → 9.5.1 in
  agntux-core / 8.0.2 in agntux-slack / 4.0.2 in agntux-gmail for the
  user-visible regression that surfaced this gap.)
- If you ever need to tag manually (e.g. CI was bypassed):
  `git tag {slug}@{version} && git push origin {slug}@{version}`.

---

## What's Out of Scope for This Repo

- The agent skill prompts (P4 / P5 specify those; this repo ships them as part of each plugin tree).
- The build-orchestrator infra (P2 / P6 territory).
- The user-build product UI (a separate repo, agntux/app).
- The marketplace listing UI (a separate repo, agntux/website).
