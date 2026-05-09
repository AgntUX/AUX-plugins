# Stage 7 — build the plugin

This is the heaviest internal stage and the lightest user-facing
one. You dispatch six internal specialists in sequence. The user
sees one "building..." line and then a summary of what was
generated.

## What you dispatch (silent — the user never hears these names)

In order:

1. **`manifest-author`** — generates `plugin.json`, `LICENSE` (mirror
   of root Apache-2.0), `NOTICE`, `marketplace/listing.yaml` (with
   `proposed_schema` block), `marketplace/icon.png` (placeholder),
   `marketplace/screenshots/` (placeholder), `README.md`, `CHANGELOG.md`.
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
6. **`invariant-checker`** — runs the three pre-flight gates:
   skill-render reproducibility (lint pass 8), agntux-core
   coordination (no changes here for net-new), and hooks byte-freeze
   (N/A — source plugins ship no hooks).

## Where the build runs

Working directory:
`<repo-root>/AUX-plugins/plugins/agntux-{slug}/`

If `<repo-root>/AUX-plugins/` doesn't exist on the user's machine,
the build creates it under `<agntux project root>/.agntux-build/builds/{session-id}/agntux-{slug}/`
instead. The user doesn't need a clone of the marketplace repo to
build a plugin — we just need a working tree.

## Confirmation gate

Before any of the specialists run, confirm with the user:

> About to scaffold `agntux-{slug}` v0.1.0 in
> {build-path}.
>
> Going to write:
> - the plugin's metadata (name, version, description)
> - the sync flow that runs every {cadence}
> - the {ui-handler-name} button you designed
> - tests so we know the plugin's shape is right
>
> Sound good? Just say yes and I'll start.

Wait for explicit yes. Then dispatch the six specialists in order.

## What the user sees during the build

A single status line that updates per specialist completion:

> Building... (1/6) metadata
> Building... (2/6) sync flow
> Building... (3/6) refresh strategy
> Building... (4/6) action button wiring
> Building... (5/6) tests
> Building... (6/6) shape checks

When all six are done, summarise in plain language:

> Done. Here's what's in `agntux-{slug}` v0.1.0:
>
> - metadata so the marketplace knows what this plugin is for
> - sync flow that polls {connector-display-name} every {cadence}
>   and writes new messages into your knowledge store
> - the "{verb-phrase}" button you designed earlier
> - tests covering the cold-start case and the basic write flow
>
> Now let's make sure it actually renders correctly in a real
> AgntUX-style host. That's a quick automated check.

Then load [`08-headless-test.md`](08-headless-test.md).

## When a specialist fails

Each specialist returns `{success: bool, error?: string,
artefacts: string[]}`. On failure, surface a plain-language
explanation:

> Hit a snag building the {part-that-failed}. The specifics:
> {plain-language-translation}.
>
> Want me to retry, or pause here while you take a look?

Don't expose internal names. "the metadata step", "the sync flow
step", "the action button step" — these are the user-facing names.

If a specialist fails twice, redirect to issues:

> Looks like the {part} isn't coming together. The issues page is
> the right place to flag this so the team can look —
> `https://github.com/AgntUX/AUX-plugins/issues`. Save the session
> file at {path} and link it in the issue.

## Saved state at end of stage 7

```json
{
  ...,
  "build_status": "success",
  "build_path": "/Users/.../.agntux-build/builds/{session-id}/agntux-linear",
  "specialists_run": ["manifest", "ingest-prompt", "source-semantics", "draft-flow", "tests", "invariant-checker"],
  "build_completed_at": "2026-05-08T..."
}
```

## What you do NOT do

- Don't reveal the specialist names.
- Don't show the user the canonical prompts, the rendering
  pipeline, or the skill-render lint output.
- Don't dispatch in parallel — the specialists have implicit
  ordering (manifest-author writes the plugin slug; ingest-prompt-
  author needs that slug to render the skill tree). Sequential.
- Don't skip the invariant check — even if the user is in a hurry,
  the check is fast and catches mid-build drift.
