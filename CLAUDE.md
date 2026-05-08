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
├── packages/mcp-license/              # Shared MCP license gate (consumed by every plugin's mcp-server)
├── marketplace/index.json             # CI-regenerated aggregate of every listing.yaml (READ-ONLY)
├── plugins/{plugin-slug}/             # One directory per plugin
├── scripts/                           # Lint, regeneration, and build-orchestration scripts
└── CLAUDE.md                          # This file
```

---

## ELv2 License — What It Means

All plugins are licensed under the **Elastic License 2.0** (ELv2). See `LICENSE`
for the canonical text.

Three explicit limitations apply to every file in this repo:

1. **No managed-service offering.** You may not provide the software (or a
   derivative) to third parties as a hosted, managed, or SaaS offering.
   A user running plugins locally inside their own host installation is fully
   permitted — that is the entire intended use case.

2. **No license-key circumvention.** The `@agntux/mcp-license` gate wrapped
   around every MCP server's `tools/call` handler constitutes the license-key
   mechanism under ELv2. Bypassing it — patching out
   `requireValidLicense()`, hard-coding a fake JWT, redistributing a stripped
   fork without the gate — violates the license. (`resources/read` is
   intentionally ungated; the UI bundle is a static shell with no
   proprietary value without the data feed served through the gated tool
   surface. See `packages/mcp-license/README.md` for the full rationale.)

3. **No removal of notices.** The `LICENSE`, `NOTICE`, and attribution lines in
   source files must remain intact in any redistribution.

When authoring or reviewing a plugin PR, verify all three limitations are
respected. If unsure, contact `legal@agntux.ai` before merging.

---

## When You Edit a Plugin

Every plugin under `plugins/{plugin-slug}/` MUST ship the following files
(see P15 §2 for the full specification):

- `.claude-plugin/plugin.json` — the host's plugin manifest. Aligned with the
  host's spec, plus exactly one runtime-only custom field
  (`recommended_ingest_cadence`, §2.5.1). Do NOT add other custom fields.
- `LICENSE` — Elastic License v2 (ELv2). Per-plugin stub pointing to the root
  `LICENSE`. Do NOT replace or modify.
- `hooks/` (optional) — plugin-author-defined Claude Code hooks. License
  enforcement does NOT live here; it lives in the MCP server via
  `@agntux/mcp-license`. agntux-core uses hooks only for schema and index
  validation; agntux-slack ships no hooks.
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
    `license` (use SPDX `Elastic-2.0`, not `ELv2`), plus
    `recommended_ingest_cadence`.
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
- **License enforcement lives in the MCP server, not in hooks.** Each plugin's
  `mcp-server/src/index.ts` imports `@agntux/mcp-license` and wraps the
  `tools/call` handler with `gate.requireValidLicense(...)`. `resources/read`
  passes through ungated (see `packages/mcp-license/README.md` §"Why only
  tools/call"). Hook semantics vary across hosts — the MCP gate is
  host-agnostic.
- **`dist/` and `out/` are tracked artifacts, not source.** The host clones
  this repo and launches `mcp-server/dist/index.js` directly with no install
  step, so the compiled JS and embedded UI bundles must already be in the
  repo. CI rebuilds them on push to `main` via `build-plugins.yml` and
  commits the regenerated tree back. **Do not hand-edit** any file under
  `plugins/*/mcp-server/dist/`, `plugins/*/ui-handlers/*/component/out/`,
  or `packages/*/dist/` — your edit will be overwritten on the next merge.
  Edit the source under `src/` and run `npm run build` from the plugin root
  (or `/dev-plugin {slug}`) to regenerate.
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
`SKILL.md` must be ≤ 500 lines (router shape — typically ≤ 100), every
sibling under `reference/` must be ≤ 500 lines (the procedural
`sync.md` body sits around 490; detail-shape siblings are smaller),
and links must stay one level deep — references reach siblings by
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

## Authoring tools

The `plugin-toolkit` plugin (specialist agents for authoring AgntUX
plugins, plus an MCP App UI test harness) has moved to the
[`agntux-plugin-dev`](https://github.com/AgntUX/agntux-plugin-dev)
marketplace. Install via `/plugin marketplace add
https://github.com/AgntUX/agntux-plugin-dev` then `/plugin install
plugin-toolkit@agntux-plugin-dev`.

---

## PR Review Checklist

Apply this checklist on every plugin PR (also available via `/review-pr`):

- [ ] `marketplace/listing.yaml` passes `npm run lint:marketplace`
- [ ] `CHANGELOG.md` version matches `plugin.json` version
- [ ] MCP server wires `@agntux/mcp-license` gate around the `tools/call` handler. `resources/read` must NOT call `gate.requireValidLicense(...)` (concurrency race + envelope-shape mismatch — see `packages/mcp-license/README.md`).
- [ ] Screenshots present, ≥1, correct dimensions (per P15 §4.2)
- [ ] `icon.png` is 512×512, ≤ 512 KB
- [ ] `README.md` ≤ 500 lines, renders cleanly via `react-markdown` + `remark-gfm`
- [ ] No custom fields added to `plugin.json` beyond host spec (one permitted
  exception: `recommended_ingest_cadence`)
- [ ] ELv2 `LICENSE` stub present and unmodified
- [ ] Version bump follows the semver rubric:
  - MAJOR: breaking change to public surface (prompts users rely on, `ux:` prompts, `requires_source_mcp.connector_slug`, removing a category or `ux_components` entry)
  - MINOR: additive non-breaking (new `ux_components`, new `supported_prompts`, new optional field, new screenshot, new category)
  - PATCH: no-surface change (copy fix, README typo, screenshot replacement, lint compliance, dependency bump)
- [ ] ELv2 limitations respected (no managed-service offering, no hook bypass, no notice removal)

---

## What's Out of Scope for This Repo

- The agent skill prompts (P4 / P5 specify those; this repo ships them as part of each plugin tree).
- The build-orchestrator infra (P2 / P6 territory).
- The user-build product UI (a separate repo, agntux/app).
- The marketplace listing UI (a separate repo, agntux/website).
