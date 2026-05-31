# Build-time self-validation — retry budgets + flagging policy (WS-A)

The structural rule: **the specialists only author; the orchestrator validates
the whole tree with the native MCP gate (`agntux_validate`) after they author,
and mechanical failures never reach the contributor.** Claude in a 12-stage flow
treats prose instructions as best-effort, and the restricted Bash sandbox can't
run the toolchain against the native host build path at all (EPERM) — so
validation is a **tool the orchestrator calls**, not a script a specialist runs.
Specialists never run scaffold / render-skill / build / lint / typecheck / tests
/ validate themselves (no Bash): `agntux_scaffold` lays the floor and
`agntux_validate` runs all of that natively. This file is the single source of
truth for the retry budgets and the mechanical-vs-judgment line; the stage-7 gate
(`07-build.md`) loops the whole tree via `agntux_validate`.

## Retry budgets

| Scope | Budget |
|---|---|
| Stage-7 `agntux_validate` → re-dispatch the owning specialist → re-validate | **5 validate→fix cycles** |
| Submit-time `agntux_write_submission` (`12-submit.md`) → specialist re-dispatch loop | **5 submit→fix loops** |

The bounds stop infinite spinning but are generous enough for genuinely-hard
convergence (a view-tool with cascading TS errors, a listing.yaml with several
interrelated over-cap fields). A specialist that exhausts its budget returns
`{success: false, error: <parsed tooling output>}`; the orchestrator escalates
per the failure path in `07-build.md` (third attempt on `executor` model=opus,
then — only if that also fails — the agntux-build-defect path below).

## Error-driven, stop-early policy (consume the verdict — never blind-guess)

On `ok:false`, `agntux_validate` / `agntux_write_submission` return a rich
verdict — `{ summary, next_action, error_kind, blocking, failed_stage, routing,
failed_file, failed_line, failed_col, error_code, stderr_tail, stdout_tail,
log_path, stages, detail, validated_at }`. **Read it; do not re-dispatch on
reflex.** Branch on `error_kind` + `blocking` BEFORE you spend a cycle:

- **`error_kind` is `environment` or `internal`, OR `blocking:false`** → **STOP
  the loop.** Do NOT re-dispatch a specialist — the tree is fine; the failure is
  an env/usage/tooling limit a specialist edit can't move. Call
  `agntux_report_defect({ session_dir })` to bundle the verdict + per-stage logs
  for the maintainer, then surface the honest one-liner from `summary` (see
  `07-build.md`'s "hit a snag" copy). Re-dispatching here only burns cycles and
  ends in the same stop.
- **`error_kind:"plugin"` (fixable)** → re-dispatch the `routing` specialist and
  **hand it the captured error**: `failed_file`, `failed_line`, `error_code`,
  `stderr_tail`, plus the `log_path` (tell the specialist to `Read` it for the
  full per-stage output). The specialist fixes THAT error — it never re-guesses
  from priors.
- **Loop guard (no-progress abort).** Track `failed_file` + `error_code` across
  cycles. If the SAME pair repeats on two consecutive cycles, the fix isn't
  converging — **abort early** (before the 5-cycle cap), call
  `agntux_report_defect({ session_dir })`, and pause. The 5-cycle hard cap from
  the budgets table above stays as the backstop for the slower-converging case.

## The mechanical-vs-judgment line (the strict rule)

Every failure is **either** mechanical **or** contributor-judgment. Classify
before surfacing anything.

- **Mechanical** — compile errors, lint codes (E01/E03/E05/E15/E27/…), char-cap
  overruns, missing files, wrong import names, missing CHANGELOG section,
  missing `_overrides/frontmatter.yaml`, render-reproducibility drift, test
  failures, any file-shape problem. **These NEVER reach the contributor.** The
  specialist iterates until its validator passes or the budget exhausts. On
  stop-early or budget exhaustion the failure is logged as an **agntux-build
  defect for the maintainer** — the bundle now comes from **`agntux_report_defect`
  (a real MCP tool)**, which writes `{session}/DEFECT.json` (verdict + per-stage
  logs + tree manifest) and returns `{ ok:true, defect_path, summary }`, **in
  addition to** the saved session file + the one-line "hit a snag" message in
  `07-build.md`. Never surfaced as a contributor to-do. Lint codes and tracebacks
  are our problem, not theirs.
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

## What each specialist authors — `agntux_validate` runs the checks

Specialists author **inputs only** (via `Write`/`Edit`); they never run a
validator. `agntux_validate` runs the checks natively and returns a verdict; on
`ok:false`, re-dispatch the owning specialist per the authoritative `failed_stage`
→ specialist table in `07-build.md` (don't duplicate that mapping here — it would
drift).

| Specialist | Authors (the inputs `agntux_validate` then checks) |
|---|---|
| `manifest-author` | `plugin.json`, `listing.yaml` (word-boundary-trim the E05 fields **at authoring time** — that's an `Edit`, not a Bash re-lint), `README`, `CHANGELOG`, `NOTICE`, `LICENSE` → checked by the `lint` + `validate` stages |
| `ingest-prompt-author` | `_overrides/frontmatter.yaml` + `_overrides/reference/*.md` → rendered + checked by the build's render-skill and lint pass-8 (surviving `{{placeholders}}` route back here) |
| `view-tool-builder` | `view-tool/src/**`, `vite.config.ts` + its HTML entry → checked by the build's view-tool pipeline, the `check-view-tool-imports.mjs` import gate (auto-re-routes apps hooks to `./lib/apps-react`, renames `useStructuredContent`, hard-fails on a symbol exported by nothing), and `typecheck` |
| `tests-author` | `__tests__/**` + `view-tool/__tests__/**` → run by the `tests` stage in **both** the plugin root (globs `__tests__/**`) and `view-tool/` |
| `source-semantics-advisor` | `_overrides/reference/cursor.md` → rendered with the rest of the skill tree |
| `ui-handler-author` / `draft-flow-author` | the UI-handler component + Send-envelope wiring → exercised by the `build` + `render` stages |

The single authoritative whole-tree gate is the agntux-build MCP server's
**`agntux_validate`** tool (and **`agntux_write_submission`**, which re-runs it
internally before writing the marker). It runs build (incl. render-skill + the
view-tool `vite → tsc → esbuild → emit-manifest` pipeline) → lint → view-tool
typecheck → tests (plugin-root **and** view-tool) → `claude plugin validate` →
render (best-effort) in the host-spawned server's NATIVE context (full
filesystem, real Chromium) and returns a structured **verdict** — `ok:false`
with a `failed_stage` + `routing` on a hard failure, never a thrown error. **The
gate is the verdict the tool RETURNS** — not a prose promise, and not an on-disk
receipt: `agntux_write_submission` re-validates the exact tree being submitted
and refuses to write `SUBMISSION.json` on any failure, so there is **no trusted
receipt** an agent could hand-write to forge a pass. The model and its
specialists only orchestrate/author by calling the tools — they **never** run
**scaffold, render-skill, the view-tool build, lint, typecheck, tests, or
validate** via Bash (the restricted sandbox that EPERMs on the native host path
and broke every prior attempt), and there is no embedded program to hand-emulate:
`agntux_scaffold` and `agntux_validate` own all of it natively.

Stage 7 runs `agntux_validate` **once** after the seven specialists author (the
fast native loop that carries the tree through preview + sync-iterate); submit
(stage 12) re-validates via `agntux_write_submission`. On either failure the flow
re-enters the specialist fix loop per the `failed_stage` table in `07-build.md`
and re-calls the tool — validation runs **once per call, never twice within
one.**
