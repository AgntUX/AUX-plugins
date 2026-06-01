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
2. **`ingest-prompt-author`** — authors
   `skills/{plugin-slug}/_overrides/frontmatter.yaml` and the
   wholesale `_overrides/reference/fetch.md` for the connector's
   read tools. It authors the `_overrides/` **inputs only** — the
   full ingest skill tree is rendered natively inside `agntux_validate`
   (its build step runs `render-skill` from canonical + your
   `_overrides/`). Never run `render-skill.mjs` yourself via Bash.
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
   **When you dispatch it, do NOT hand it a fixed list of phrases/contracts
   to assert** (e.g. "assert cursor.md documents past-event eviction") — that
   seeds phantom assertions that fail the `tests` gate on strings no other
   specialist wrote. Tell it to **derive every assertion from the authored
   tree** per its golden rule (Read the file, copy a verbatim substring); pass
   only the plugin's shape facts (is the cursor non-trivial, are there threads,
   are there write tools), not the assertion strings.
6. **`view-tool-builder`** — authors the per-handler `view-tool/src/` UI
   (the component, the Send-envelope wiring) and its sibling `{name}.html`
   entries. It does **not** author `package.json` / `vite.config.ts` /
   `tsconfig.json` / `src/lib/**` — those are the pre-placed scaffold floor
   (`view_tool: true`), and re-authoring them is what dropped the
   `@agntux/ui-primitives` dep and drifted the apps-client in Test #5. It does
   **not** run the build: the view-tool pipeline
   (vite → tsc/esbuild → emit-manifest, the Zod-schema validation of
   `view-tools.manifest.json` against @agntux/plugin-runtime, the
   plugin-slug prefix assertion on every view_tools[].name, and the
   architectural-crash esbuild fallback per §3 below) runs natively
   inside `agntux_validate`'s build step. Never run vite / `npm run
   build` / `emit-manifest` yourself via Bash.
7. **`invariant-checker`** — checks the source-plugin shape invariants
   by **reading** the tree (no `mcp-server/`, no `.mcp.json`, manifest
   emitted, prefix-asserted, no forbidden host imports), plus
   agntux-core coordination (no changes here for net-new) and hooks
   byte-freeze (N/A — source plugins ship no hooks). The skill-render
   reproducibility check (lint pass 8) is enforced natively inside
   `agntux_validate`; this checker confirms shape via Read/Grep — it
   does not run lint or render via Bash.

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

## Hard pre-flight A — MCP tools callable (unconditional — before any "built" claim)

Build, validation, and submission run through the **`agntux-build` MCP server**
(declared in this plugin's `.mcp.json`, launched at `mcp-server/dist/index.js`).
That server runs **natively in the host process** — full filesystem, real
Chromium — so it works in a contributor sandbox with no marketplace clone, unlike
the restricted Bash sandbox where the toolchain can't run. The operative
pre-flight is therefore **"are the MCP tools callable?"**, not "do the toolchain
files exist on disk."

Before dispatching any specialist, assert the `agntux-build` MCP server is up and
its tools — `agntux_validate`, `agntux_write_submission`,
`agntux_confirm_submission`, `agntux_report_defect` — are available to call. If
they are NOT callable,
the build can never honestly reach a green gate, and the ONLY correct move is to
STOP and log an agntux-build defect (the MCP server didn't start). **Never fall
back to a prose/bash program, a hand-written receipt, or a "built" claim when the
MCP tools are absent** — that fallback IS the forgery/bypass path this design
closes.

(The toolchain files still ship in-bundle under `$CLAUDE_PLUGIN_ROOT` — that's
how the MCP server runs them natively — but the bundle's presence on disk is no
longer the pre-flight: the tools being *callable* is. Do not shell out to
`bin/validate-plugin.mjs` yourself; invoke the MCP tool.)

- **Tools callable** → proceed to Hard pre-flight B.
- **Tools not callable** → STOP. Do NOT dispatch specialists. Do NOT shell out to
  a validator, write a receipt, or claim "built". The build-tools pre-flight in
  `SKILL.md` should already have caught this before stage 3, so reaching here means
  the server stopped (or never re-spawned) mid-flow. This is almost always a
  fixable environment state — the AgntUX desktop app needs a fresh start to pick
  the build server back up — and the user can fix it themselves. Say exactly this,
  then stop (do **not** use the "hit a snag / the team will look into it" copy —
  that's reserved for failures the user can't fix):

  > I can't reach the AgntUX build tools right now — that usually means the AgntUX
  > desktop app needs a fresh start to pick them back up. Quit the AgntUX desktop
  > app completely, reopen it, then run `/agntux-build:build` again and we'll carry
  > on from here. Nothing's lost.

  Only if a full quit-and-reopen still leaves the tools uncallable is it a genuine
  agntux-build defect — then (and only then) log it for the maintainer (saved
  session + the one-line "hit a snag" message).

## Hard pre-flight B — marketplace-asset scaffold (unconditional — before specialist dispatch)

Then scaffold the marketplace-asset floor. This is **unconditional and
load-bearing**. Call the **`agntux_scaffold` MCP tool** — do NOT run
`scaffold-marketplace-assets.mjs` yourself via Bash. The Bash sandbox is a
restricted Linux container that cannot write the native host build path (EPERM);
the MCP server runs natively and writes it fine. That EPERM-then-`/tmp`-escape is
exactly what produced incomplete trees and failed submissions before.

```
agntux_scaffold({ slug: "agntux-{slug}", plugin_dir: "{build-path}", view_tool: {ships-UI} })
# {build-path} = the tree from "Where the build runs" (the sandbox under
#   <agntux root>/.agntux-build/builds/{session-id}/agntux-{slug}/).
# {ships-UI} = true when stage 5 decided the plugin ships ≥1 UI handler
#   (the common case for a connector plugin); omit/false for a headless
#   ingest-only plugin. When true, the scaffold ALSO pre-places the
#   build-critical view-tool floor (package.json WITH the @agntux/ui-primitives
#   dep, the byte-frozen apps-client, tsconfig/tailwind/vite.config/emit-manifest)
#   so view-tool-builder authors ONLY the per-handler UI and the
#   "Rollup failed to resolve @agntux/ui-primitives" + apps-client-drift (E26)
#   failures cannot recur.
```

Branch on the RETURN value:

- **`{ ok: true }`** → proceed to the confirmation gate and specialist dispatch.
- **`{ ok: false, ... }`** → STOP. Do NOT dispatch specialists, do NOT fall back
  to running the scaffold script via Bash, do NOT hand-create the floor files. A
  scaffold failure is an agntux-build defect (missing canonical template,
  unwritable dir), not a contributor problem — log it for the maintainer (saved
  session + the one-line "hit a snag" message).

The tool runs `scripts/scaffold-marketplace-assets.mjs` natively (per WS-A.3 /
WS-C.2). It is idempotent and:

- copies the 512×512 icon placeholder to `marketplace/icon.png` if absent;
- emits the `skills/agntux-{slug}/_overrides/frontmatter.yaml` **floor** from the
  canonical template (`canonical/skills/_overrides/frontmatter.template.yaml`),
  substituting the ten render placeholders from build state. This guarantees
  lint pass 8 can reproduce the skill tree (closing E15) even before
  `ingest-prompt-author` writes the real substitution map — which overwrites the
  floor on a normal build;
- writes a placeholder `marketplace/README.md` note, the plugin-root
  `package.json`, and `vitest.config.ts`;
- when called with `view_tool: true`, pre-places the build-critical view-tool
  floor: `view-tool/package.json` (with the `@agntux/ui-primitives` +
  `@agntux/plugin-runtime` workspace deps already wired and a handler-agnostic
  build script that loops over `*.html`), `vite.config.ts`, `tsconfig.json`,
  `tailwind.config.mjs`, `scripts/emit-manifest.mjs`, the byte-frozen
  `src/lib/apps-client/**` (E26) + `src/lib/apps-react/**`, `src/globals.css`,
  and `src/vite-env.d.ts`. `view-tool-builder` then authors only the per-handler
  UI on top of this floor — never the build config.

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
third attempt also fails — or the moment you hit a stop-early verdict
(`blocking:false`, `error_kind` of `environment`/`internal`) — do you
surface anything to the user, and even then it's a one-liner. First
bundle the failing session with the MCP tool:

```
agntux_report_defect({ session_dir })
# → { ok:true, defect_path, summary } — writes {session}/DEFECT.json
#   (verdict + per-stage logs + tree manifest) for the maintainer.
```

Then surface the one-liner (now backed by `defect_path`):

> Hit a snag I couldn't fix on my own. Saving the session so the team
> can look — `https://github.com/AgntUX/AUX-plugins/issues`.

No technical detail in the surface — `DEFECT.json` + the session file
carry the verdict and traceback for maintainers.

## Stage-7 verification — `agntux_validate` runs the gate natively; submit re-validates (WS-A.2)

The single authoritative build → render-skill → lint → typecheck → tests →
`claude plugin validate` → render gate is the **`agntux-build` MCP server's
tools**: `agntux_validate` (the fast pre-check) and `agntux_write_submission`
(which re-validates internally at submit, fail-closed, against the exact
signature-carrying tree). Both run **natively in the server** — full filesystem,
host-path-writable, real Chromium — and **never** as a Bash program. There is no
trusted receipt to forge, and no caller verdict is trusted.

The seven specialists **only author** (`Write`/`Edit` into the build tree). They
do NOT run build, render-skill, lint, typecheck, tests, or the view-tool pipeline
themselves — those deterministic steps all run inside `agntux_validate` (in the
restricted Bash sandbox they EPERM on the native host path and escape to `/tmp`,
yielding an incomplete tree — the exact failure this closes). After the seven
have authored, call once:

```
agntux_validate({ slug: "agntux-{slug}", plugin_dir: "{build-path}" })
```

and loop on the verdict (below) until `ok:true` — that carries the tree through
preview (stage 8) and sync-iterate (stages 9–11). What `agntux_validate` runs for
you natively, that specialists must never attempt via Bash:

- the **skill render** (`render-skill` from canonical + your `_overrides/`, in the
  build step) — so lint pass-8 render-reproducibility checks a freshly-rendered
  tree;
- the **view-tool build** (`vite → tsc → esbuild → emit-manifest`) and the
  data-driven `check-view-tool-imports.mjs` gate before it — so `dist/` (incl.
  `ui-resources/*.html`) exists for stage 8's headless render and wrong-source /
  hallucinated `@agntux/ui-primitives` imports are caught (and apps hooks
  auto-re-routed) up front;
- **vitest** in the plugin root and the view-tool;
- pass-8 render-reproducibility + the source-plugin shape invariants;
- the marketplace **lint** (`lint:marketplace`) and `claude plugin validate`.

When `agntux_validate` (here at stage 7) or `agntux_write_submission` (at submit,
stage 12) returns `ok:false`, the structured verdict names the fix and writes
nothing. The full shape is `{ summary, next_action, error_kind, blocking,
failed_stage, routing, failed_file, failed_line, failed_col, error_code,
stderr_tail, stdout_tail, log_path, stages, stage_results, detail, validated_at }`
— **read it, don't blind-guess.** First read `summary` / `next_action` (the
plain-English verdict). Then branch on `error_kind` + `blocking`:

- **`error_kind:"plugin"` (fixable, `blocking:true`)** → re-dispatch the owning
  specialist (`routing` / the `failed_stage` table below) **WITH the captured
  error embedded** — `failed_file`, `failed_line`, `error_code`, `stderr_tail` —
  and/or tell it to `Read` `log_path` (the native host dir holding the full
  per-stage logs: `{stage}.out.log`, `{stage}.err.log`, `verdict.json`). The
  specialist fixes THAT real compiler/linter/test error in its `_overrides/` /
  `src` inputs — it never re-guesses from priors. Re-call the tool afterward
  (validation runs **once per call, never twice within one**).
- **`blocking:false`, or `error_kind` of `environment` / `internal`** → an
  env/usage/tooling limit a specialist edit can't move. **STOP** — do NOT
  re-dispatch a specialist. Call `agntux_report_defect({ session_dir })` to
  bundle the verdict + per-stage logs, then surface the honest `summary`
  one-liner (the "hit a snag" copy above).

**Fix the whole `stage_results[]` punch-list in ONE pass — don't pay a
round-trip per stage.** `agntux_validate` no longer stops at the first failing
stage: the build-independent stages (lint, plugin-root tests, structural
validate) run even when the build fails, so `stage_results` is the full list of
`{ stage, status, errors[] }` for everything that ran. When `next_action` says
"N stages failed", dispatch the owning specialist for EVERY `status:"fail"`
entry (use the mapping below, one specialist per failed stage — they edit
different files so they don't conflict), then re-validate ONCE. `failed_stage` /
`routing` still name the single highest-priority failure for back-compat, but
fixing only that one wastes a full re-validate surfacing the next. Build-gated
stages show `status:"skipped", reason:"build_failed"` until the build is green —
fix the build first, then they run.

The `failed_stage` → specialist mapping (a `build` failure can be a render-skill
error — surviving `{{placeholders}}` in `_overrides/frontmatter.yaml` →
`ingest-prompt-author`):

| `failed_stage` | Re-dispatch |
|---|---|
| `build` (view-tool vite / tsc / esbuild / emit-manifest / import gate) | `view-tool-builder` |
| `typecheck` (view-tool `tsc --noEmit`) | `view-tool-builder` |
| `lint` — read `stage_results[].errors[].lint_findings[]` (each `{code, file, message, routing}`) | dispatch **every distinct owner** in `stage_results[].errors[].routings`, one per code — e.g. an E05 listing-field error → `manifest-author` AND an E15 render-drift error → `ingest-prompt-author` in the SAME pass (don't fix only the primary `routing` and re-validate — the other code fails the next round) |
| `tests` | `tests-author` |
| `validate` (`claude plugin validate` — plugin.json / manifest shape) | `manifest-author` |
| `render` (console errors / handler `tool error:` / harness crash) | `executor` (model=sonnet, per `08-headless-test.md` self-fix) |
| `usage` (bad flag, missing `--plugin-dir`, plugin dir not found) | **none** — operator/environment error. Fix the invocation; do NOT re-dispatch a specialist or burn a cycle. |

Loop submit→fix up to **5 times** (budgets, the no-progress loop guard, and the
mechanical-vs-judgment line live in [`self-validation.md`](self-validation.md)) —
each iteration is a fresh `agntux_write_submission` call after the specialist's
fix. These are **mechanical** failures — the user NEVER sees a lint code or a
traceback. If the same `failed_file` + `error_code` repeats across two
consecutive cycles (no progress) or you exhaust the 5 cycles, call
`agntux_report_defect({ session_dir })` to log the defect for the maintainer
(`DEFECT.json` + the saved session file + the one-line "hit a snag" message
above) and stop. Do NOT surface lint/build/test detail to the contributor, do
NOT hand-write a marker to get past a failure, and do NOT let the flow claim
"submitted" with an unvalidated tree.

## Saved state at end of stage 7

```json
{
  ...,
  "build_path": "/Users/.../.agntux-build/builds/{session-id}/agntux-linear",
  "specialists_run": ["manifest", "ingest-prompt", "source-semantics", "draft-flow", "tests", "view-tool-builder", "invariant-checker"],
  "build_completed_at": "2026-05-08T..."
}
```

Record `build_path` (the exact tree every later stage builds + validates) and
`specialists_run`. The authoritative validation gate is no longer a stage-7
receipt — it runs at submit (`12-submit.md` step b.5), where
`agntux_write_submission` re-validates the final, signature-carrying tree
internally and refuses to write `SUBMISSION.json` on any failure. There is
nothing for stage 7 to record as proof and nothing for a later stage to trust —
the proof is produced by the tool at the moment of submission, against the exact
bytes submitted.

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

- `submission_id` comes from the `agntux_write_submission` return's
  `submission_id` field once the submission is created (the marker key is
  `submission_id`, not `id` — see `12-submit.md` step d); at end of stage 7
  (pre-submission) write a sentinel value of `"pending-{session-id}"` so the file
  exists and `:revise` can detect an in-progress build.
- After stage 12 completes and the submission is confirmed, overwrite
  `last-submission.json` with the real `submission_id` the tool returned.
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
