# Build-time self-validation — retry budgets + flagging policy (WS-A)

The structural rule of v2: **every specialist verifies its own output with the
real tooling before the build advances, and mechanical failures never reach the
contributor.** Claude in a 12-stage flow treats prose instructions as
best-effort; a validator the stage can't move past is not optional. This file is
the single source of truth for the budgets and the mechanical-vs-judgment line.
The per-specialist `agents/*.md` carry the specific validator command; the
stage-7 final gate (`07-build.md`) loops the whole tree.

## Retry budgets

| Scope | Budget |
|---|---|
| Each specialist's own validator, within its dispatch | **5 edit-and-revalidate cycles** |
| Submit-time validator (`12-submit.md`) → specialist re-dispatch loop | **5 submit→fix loops** |

The bounds stop infinite spinning but are generous enough for genuinely-hard
convergence (a view-tool with cascading TS errors, a listing.yaml with several
interrelated over-cap fields). A specialist that exhausts its budget returns
`{success: false, error: <parsed tooling output>}`; the orchestrator escalates
per the failure path in `07-build.md` (third attempt on `executor` model=opus,
then — only if that also fails — the agntux-build-defect path below).

## The mechanical-vs-judgment line (the strict rule)

Every failure is **either** mechanical **or** contributor-judgment. Classify
before surfacing anything.

- **Mechanical** — compile errors, lint codes (E01/E03/E05/E15/E27/…), char-cap
  overruns, missing files, wrong import names, missing CHANGELOG section,
  missing `_overrides/frontmatter.yaml`, render-reproducibility drift, test
  failures, any file-shape problem. **These NEVER reach the contributor.** The
  specialist iterates until its validator passes or the budget exhausts. On
  exhaustion the failure is logged as an **agntux-build defect for the maintainer**
  (the maintainer) — surfaced out-of-band (e.g. the saved session file + the
  one-line "hit a snag" message in `07-build.md`), never as a contributor
  to-do. Lint codes and tracebacks are our problem, not theirs.
- **Contributor-judgment** — data-source connection details, OAuth scope intent,
  business-logic decisions about what the plugin should *do*. These continue to
  use the existing `user_fixable` copy-prompt card UX. Example: "your plugin
  reads/writes calendar events but the OAuth scopes aren't declared — please add
  them in Claude Cowork."

The line is enforced at every escalation point: if a failure touches a lint
code, build error, test failure, or any file-shape problem → mechanical → fix it
or log it for the maintainer; never fail-to-contributor. Only fail-to-contributor when the
failure genuinely needs the contributor's judgment.

## Word-boundary trim (shared algorithm for E05)

When a listing.yaml field overruns its char cap, trim deterministically rather
than asking the contributor to rewrite:

1. Cap is on the parsed string (the value, excluding YAML quotes).
2. Reserve one code unit for the `…` ellipsis: budget = cap − 1.
3. Take the first `budget` chars, cut back to the last space (avoid a mid-word
   cut), strip trailing whitespace, append `…`.

This is the same algorithm the worker's `scripts/auto-fix/trim-listing-yaml.mjs`
uses for the top-level scalar fields (`tagline` 80, `description` 500), so a
field trimmed at build time and a field trimmed by the worker converge to the
same shape. Nested fields (`proposed_schema.*.description` 200, etc.) are trimmed
the same way by editing the specific line.

## Where the validators live

| Specialist | Validator (run after writing its output) |
|---|---|
| `manifest-author` | `npm run lint:marketplace -- --plugin {slug}` (parse + trim E05; re-lint) |
| `ingest-prompt-author` | `node scripts/render-skill.mjs --validate-overrides {slug}` |
| `view-tool-builder` | `node $CLAUDE_PLUGIN_ROOT/scripts/check-view-tool-imports.mjs --plugin-dir <tree> --fix` (data-driven @agntux/ui-primitives import gate: auto-re-routes apps hooks to `./lib/apps-react`, renames `useStructuredContent`, hard-fails on a symbol exported by nothing) → `npm run build --prefix view-tool/` |
| `tests-author` | vitest in **both** the plugin root (`__tests__/**`) **and** `view-tool/` (`view-tool/__tests__` + `view-tool/src/**`) — the plugin-root `vitest.config.ts` globs only `__tests__/**`, so the old `npm test --workspace plugins/{slug}` note missed the view-tool suite entirely. Run both, or just let the gate below do it. |
| `ui-handler-author` / `draft-flow-author` | lint / build / test as relevant to the artifacts they emit |

The single authoritative whole-tree gate is the deterministic
`bin/validate-plugin.mjs <slug> --plugin-dir <tree>` — it runs build → lint →
view-tool typecheck → tests (plugin-root **and** view-tool) → `claude plugin
validate` → render (best-effort) in order and aborts non-zero on the first hard
failure. **"Hard exit" means the script's exit code, not a prose promise.** It
runs **once, at submit** (`12-submit.md` step b.5): the stage-12 marker program
itself runs it against the exact tree being submitted and refuses to write
`SUBMISSION.json` on any non-zero exit — there is **no trusted receipt** an agent
could hand-write to forge a pass. The build + validate toolchain ships inside the
plugin bundle, so this runs in a contributor sandbox with no marketplace clone.

Stage 7 does NOT re-run the full validator (that would double-build the same gate
within one submit attempt); each specialist's own per-artifact check above is the
fast inner loop that carries the tree through preview + sync-iterate. On a
submit-time failure the flow re-enters the specialist fix loop per the
`failed_stage` table in `07-build.md` and retries submit — the validator runs
**once per submit attempt, never twice within one.**
