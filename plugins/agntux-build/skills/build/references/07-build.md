# Stage 7 — build the plugin

This is the heaviest internal stage and the lightest user-facing
one. You dispatch seven internal specialists in sequence. The user
sees one "building..." line and then a summary of what was
generated.

## What you dispatch (silent — the user never hears these names)

In order:

1. **`manifest-author`** — generates `plugin.json`, `LICENSE` (mirror
   of root Apache-2.0), `NOTICE`, `marketplace/listing.yaml` (with
   `proposed_schema` block), `marketplace/icon.png` (placeholder),
   `README.md`, `CHANGELOG.md`. (No screenshots — the marketplace ships
   icon-only listings per WS-C.2.)
2. **`ingest-prompt-author`** — generates
   `skills/{plugin-slug}/_overrides/frontmatter.yaml` and the
   wholesale `_overrides/reference/fetch.md` for the connector's
   read tools. Runs `scripts/render-skill.mjs {plugin-slug}` to emit
   the full ingest skill tree.
3. **`source-semantics-advisor`** — picks a cursor strategy from
   `canonical/prompts/ingest/cursor-strategies.md` based on what the
   connector's read tools support (per-channel cursor map, single
   timestamp, ETag, etc.) and writes the override into
   `_overrides/reference/cursor.md` if non-default.
4. **`draft-flow-author`** — for the write-back path: ensures the
   UI handler's component emits a connector-targeted envelope on
   Send (no chat round-trip) and that the view tool reads the
   action file's `## Compose payload` section.
5. **`tests-author`** — generates the vitest static-grep tests
   under `__tests__/`: cold-start, cursor-map (when non-trivial),
   thread-association (when threads), draft-flow (write-capable),
   render-reproducibility (mirrors lint pass 8). No LLM at test time.
   For UI-bearing plugins (anything that ships `view-tool/`), also
   generates `view-tool/__tests__/payload-shape.test.ts` from the
   canonical scaffold at
   `canonical/ui-handlers/_template/view-tool/__tests__/payload-shape.test.ts`
   — a byte-budget + frozen-keyset regression guard required by lint
   pass 11 (E24/E25). Tunes `KEPT_KEYS` and `PAYLOAD_BUDGET_BYTES`
   to the plugin's actual structuredContent shape, then substitutes
   `{{ui-name}}` / `{{view-tool-name}}` like every other content
   placeholder. See plugins/agntux-core/CHANGELOG.md → 9.5.3 for the
   bug class this guard catches.
6. **`view-tool-builder`** — runs the view-tool/ build pipeline
   (vite → tsc/esbuild → emit-manifest), validates the emitted
   view-tools.manifest.json against the Zod schema from
   @agntux/plugin-runtime, asserts plugin-slug prefixing on every
   view_tools[].name. Falls back to direct-esbuild re-build on
   architectural-crash hosts per §3 below.
7. **`invariant-checker`** — runs the four pre-flight gates:
   skill-render reproducibility (lint pass 8), agntux-core
   coordination (no changes here for net-new), hooks byte-freeze
   (N/A — source plugins ship no hooks), and source-plugin shape
   invariants (no `mcp-server/`, no `.mcp.json`, manifest emitted,
   prefix-asserted, no forbidden host imports).

## Where the build runs

Working directory:
`<repo-root>/AUX-plugins/plugins/agntux-{slug}/`

If `<repo-root>/AUX-plugins/` doesn't exist on the user's machine,
the build creates it under `<agntux project root>/.agntux-build/builds/{session-id}/agntux-{slug}/`
instead. The user doesn't need a clone of the marketplace repo to
build a plugin — we just need a working tree.

### Build-prep the contributor never sees

Three preconditions must hold before `vite build` can run against a
scaffolded component. They're handled transparently — none surface
in the user-facing status line.

1. **`@agntux/ui-primitives` resolves.** The canonical scaffold's
   `component/package.json` declares the workspace dep via
   `file:../../../../../packages/agntux-ui-primitives`. Inside an
   AUX-plugins clone the path resolves to the marketplace's tracked
   `packages/`. Outside, the orchestrator must symlink (or copy on
   filesystems that don't allow symlinks) from one of three sources,
   in priority order: the `AGNTUX_PACKAGES_DIR` env var, the
   marketplace clone's `packages/` if present, or
   `<CLAUDE_PLUGIN_ROOT>/canonical/packages/`. The marketplace's
   `scripts/build-plugin.mjs` already implements this auto-resolution;
   when the orchestrator shells out to it, no additional work is needed.
2. **The 11 locale stubs exist.** `use-translation.ts` static-imports
   `en-US.json` plus ten siblings (es-ES, es-MX, fr-FR, de-DE, ja-JP,
   zh-CN, pt-BR, it-IT, ko-KR, ru-RU). The canonical scaffold template
   already ships all 11 (ten are en-US copies awaiting real
   translations), so the moment `manifest-author` copies the template
   into the build path, every locale Vite expects is present. Plugin
   authors who customise the hook to import only what they ship are
   unaffected — the build script does no runtime locale stubbing, so
   existing trees aren't modified silently.
3. **The toolchain has a fallback.** Some hosts (aarch64 Linux is the
   canonical case) crash `@vitejs/plugin-react`'s babel transform with
   SIGBUS / "Bus error" / "core dumped" on larger components.
   `@vitejs/plugin-react-swc` also crashes on the same hosts.
   `scripts/build-plugin.mjs` watches the build's stdout/stderr and
   the child-process exit signal; on an architectural-crash match it
   re-runs the build through direct `esbuild` (jsx=automatic,
   target=es2022, format=esm, react/react-dom aliased, tailwindcss
   external). Real build errors — TypeScript, missing imports, etc.
   — propagate without triggering the fallback so the contributor
   sees the actual cause.

You don't need to mention any of this in chat. The user's view stays
"Building... (N/7) {step}".

### View-tool bundle shape — HTML-entry rule

The view-tool build emits self-contained iframe bundles at
`view-tool/dist/ui-resources/{ui-name}.html`. Each file is registered
with the MCP App protocol as `mimeType: "text/html"`, so its body
MUST be a real HTML document, not a JavaScript module renamed to
`.html`. Compliant hosts (Claude Cowork, MCPJam) reject the latter
with "Unsupported UI resource content format".

The canonical scaffold gets this right by pointing Vite's
`rollupOptions.input` at a real HTML file next to `vite.config.ts`
(e.g. `{{ui-name}}.html`) which imports the `.tsx` entry via
`<script type="module">`. `vite-plugin-singlefile` then inlines the
JS bundle into that HTML and emits a valid self-contained document.

What goes wrong if you instead point `input` directly at the `.tsx`
and override `output.entryFileNames: "[name].html"`: Rollup just
renames the JS module to `.html` and the host rejects it. The
marketplace linter's pass 10 catches this at PR time by reading
the first bytes of every shipped bundle and refusing anything
that doesn't begin with `<!doctype`/`<html>`.

If the view-tool-builder specialist regenerates `vite.config.ts`,
keep the input pointing at an HTML entry and add/keep the sibling
HTML next to it. The canonical template at
`canonical/ui-handlers/_template/view-tool/{__ui-name__.html,vite.config.ts}`
shows the shape.

## Hard pre-flight scaffold (unconditional — runs before specialist dispatch)

Before dispatching any specialist, run the marketplace-asset scaffold. This is
**unconditional and load-bearing** — capture its exit code and halt stage 7 on a
non-zero exit (a scaffold failure is an agntux-build defect, not a contributor
problem):

```bash
node scripts/scaffold-marketplace-assets.mjs --slug agntux-{slug}
# non-zero exit → STOP. Do not dispatch specialists. Log the defect for the maintainer.
```

The script (per WS-A.3 / WS-C.2) is idempotent and:

- copies the 512×512 icon placeholder to `marketplace/icon.png` if absent;
- emits the `skills/agntux-{slug}/_overrides/frontmatter.yaml` **floor** from the
  canonical template (`canonical/skills/_overrides/frontmatter.template.yaml`),
  substituting the ten render placeholders from build state. This guarantees
  lint pass 8 can reproduce the skill tree (closing E15) even before
  `ingest-prompt-author` writes the real substitution map — which overwrites the
  floor on a normal build;
- writes a placeholder `marketplace/README.md` note.

It does **not** create `marketplace/screenshots/` — screenshots are no longer
required (WS-C.2).

## Confirmation gate

Before any of the specialists run, confirm with the user:

> About to scaffold `agntux-{slug}` v0.1.0.
>
> Going to write:
> - the plugin's metadata (name, version, description)
> - the sync flow that runs every {cadence}
> - the {N} button(s) you designed: {comma-list of verb phrases}
> - tests so we know the plugin's shape is right
>
> Sound good? Just say yes and I'll start.

Wait for explicit yes. Then dispatch the seven specialists in order.

## What the user sees during the build

A single status line that updates per specialist completion:

> Building... (1/7) metadata
> Building... (2/7) sync flow
> Building... (3/7) refresh strategy
> Building... (4/7) action buttons
> Building... (5/7) tests
> Building... (6/7) view tool
> Building... (7/7) shape checks

When all seven are done, summarise in plain language:

> Done. Here's what's in `agntux-{slug}` v0.1.0:
>
> - metadata so the marketplace knows what this plugin is for
> - sync flow that polls {connector-display-name} every {cadence}
>   and writes new messages into your knowledge store
> - the {N} button(s) you designed: {comma-list of verb phrases}
> - tests covering the cold-start case and the basic write flow
>
> Building's done — running the final render check now.

Then load [`08-headless-test.md`](08-headless-test.md) automatically
(no confirmation gate). The build summary and the render check are one
continuous unattended sequence: do NOT end the turn after the summary
— immediately load and execute `08-headless-test.md` in the same turn.

## When a specialist fails

Each specialist returns `{success: bool, error?: string,
artefacts: string[]}`. On failure, **do not pause for the user**.
Re-dispatch the specialist with the error attached as feedback.
The user sees the same status line (`Building... (N/7) {step}`)
with no failure narration.

If the same specialist fails twice on the same step, dispatch a
third attempt with `executor` (model=opus) carrying the prior two
error messages and a "fix and continue" directive. Only if that
third attempt also fails do you surface anything to the user, and
even then it's a one-liner:

> Hit a snag I couldn't fix on my own. Saving the session so the team
> can look — `https://github.com/AgntUX/AUX-plugins/issues`.

No technical detail in the surface — the session file carries the
traceback for maintainers.

## Stage-7 final gate (end-to-end verifier — WS-A.2)

After all seven specialists dispatch and before the build summary, run ONE
end-to-end verifier against the contributor's plugin tree on the same machine
that built it. The build flow does NOT advance to the summary / stage 8 until
this exits 0:

```bash
cd plugins/agntux-{slug} && npm install && \
  npm run lint:marketplace -- --plugin agntux-{slug} && \
  npm run build --if-present && \
  npm test --if-present
```

(When the working tree is the `.agntux-build/builds/{id}/agntux-{slug}/` copy
rather than an AUX-plugins clone, run the equivalent there — the intent is
"install + lint + build + test all return zero on the same machine that built
the plugin.")

On any non-zero exit, parse the failing command + error and re-dispatch the
owning specialist:

| Failing command | Re-dispatch |
|---|---|
| `lint:marketplace` (E05 / E11 / E04 / E14) | `manifest-author` |
| `lint:marketplace` pass 8 / render drift (E15) | `ingest-prompt-author` |
| `npm run build` (view-tool compile) | `view-tool-builder` |
| `npm test` | `tests-author` |

Loop the verifier up to **5 times** after specialist-driven fixes (budgets +
the mechanical-vs-judgment line live in
[`self-validation.md`](self-validation.md)). These are **mechanical** failures —
the user NEVER sees a lint code or a traceback. If still failing after 5 cycles,
log an agntux-build defect for the maintainer (the saved session file + the one-line "hit
a snag" message above) and stop. Do NOT surface lint/build/test detail to the
contributor, and do NOT let the flow reach "ready to submit?" with an
unvalidated tree.

## Saved state at end of stage 7

```json
{
  ...,
  "build_status": "success",
  "build_path": "/Users/.../.agntux-build/builds/{session-id}/agntux-linear",
  "specialists_run": ["manifest", "ingest-prompt", "source-semantics", "draft-flow", "tests", "view-tool-builder", "invariant-checker"],
  "build_completed_at": "2026-05-08T..."
}
```

### `last-submission.json` — written on every successful build

After all seven specialists complete without error, write
`<agntux project root>/.agntux-build/last-submission.json`:

```json
{
  "submission_id": "{submission_id}",
  "slug": "agntux-{slug}",
  "version": "{plugin_version}",
  "blockers_summary": []
}
```

- `submission_id` comes from stage 12's `SUBMISSION.json` `submission_id`
  field once the submission is created (the marker key is `submission_id`, not
  `id` — see `12-submit.md` step d); at end of stage 7 (pre-submission) write a
  sentinel value of `"pending-{session-id}"` so the file exists and `:revise` can
  detect an in-progress build.
- After stage 12 completes and the submission is confirmed, overwrite
  `last-submission.json` with the real `submission_id` from `SUBMISSION.json`.
- `blockers_summary` is an empty array at a clean build; the marketplace worker
  populates it during review. `:revise` reads this file and uses the
  `submission_id` as `marker.revision_of` for the next submission.
- This file is read-only for `:revise`; only the build flow writes it.

## What you do NOT do

- Don't reveal the specialist names.
- Don't show the user the canonical prompts, the rendering
  pipeline, or the skill-render lint output.
- Don't dispatch in parallel — the specialists have implicit
  ordering (manifest-author writes the plugin slug; ingest-prompt-
  author needs that slug to render the skill tree). Sequential.
  view-tool-builder must run AFTER ui-handler-author has produced
  view-tool/src/*.ts (typically via the manifest-author +
  draft-flow-author chain), and BEFORE invariant-checker which
  asserts the build output shape.
- Don't skip the invariant check — even if the user is in a hurry,
  the check is fast and catches mid-build drift.
