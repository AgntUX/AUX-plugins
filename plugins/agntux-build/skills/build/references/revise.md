# `/agntux-build:revise` — revise a plugin after marketplace review feedback

This reference is loaded when the first `$ARGUMENTS` token is `revise`.

The `:revise` subcommand is the **only** entry point for addressing
marketplace review blockers. It reads the prior submission record, routes
each blocker to the right specialist, re-runs the build, and sets the
`revision_of` marker so the new submission chains to the prior one.

Voice rules from `SKILL.md` apply here with one change: **suppress
conversational stages 1–5, gratitude prompts, and the confirmation gate**.
`:revise` is invoked programmatically from the marketplace worker or by an
experienced contributor who already went through the full flow. Jump directly
to work.

---

## Invocation forms

```
/agntux-build:revise <slug-or-path>
/agntux-build:revise <slug-or-path> --fixes <code,code,...>
```

- `<slug-or-path>` — the plugin slug (e.g. `agntux-linear`) or an explicit
  path to the plugin directory. Resolve to the plugin's working directory the
  same way `build` does (walk up for `.agntux-build/`, fall back to
  `.agntux-build/builds/{session-id}/agntux-{slug}/`).
- `--fixes <code,code>` — optional comma-separated list of error codes (e.g.
  `E05,E15`). When present, routes work only to the agents that own those
  codes. When absent, all user-fixable blockers from `last-submission.json`
  (or from the inline feedback text the user provides) are addressed.

---

## Step 0 — read `last-submission.json`

Read `<agntux project root>/.agntux-build/last-submission.json`:

```json
{
  "submission_id": "abc123...",
  "slug": "agntux-{slug}",
  "version": "0.1.0",
  "blockers_summary": []
}
```

If the file is absent, surface a one-liner and stop:

> No prior submission found for this plugin. Run `/agntux-build:build` first.

If `submission_id` starts with `"pending-"`, the prior build completed but the
submission was not confirmed. Treat this the same as a missing file and surface:

> The prior build didn't reach submission. Complete the submission first, then
> run `:revise` with the marketplace feedback.

If the prior verdict was `success` (`blockers_summary.length === 0` and
`submission_id` does not start with `"pending-"`), fall through to a
normal `:build` with the same slug — a successful submission is a new release,
not a revision. If `blockers_summary` is non-empty the flow proceeds regardless
of `submission_id` shape.

---

## Step 1 — resolve the feedback

If `--fixes` was provided: the error codes are the work list.

If not provided and the user included plain-English feedback in their message
(the consolidated prompt card from the marketplace UI pastes it inline),
translate each bullet into the error code(s) it addresses using this map:

| Plain-English fragment | Code(s) |
|---|---|
| "description is too long" / "tagline over the limit" / "char cap" | E05 |
| "icon missing" / "no icon" | E01 |
| "CHANGELOG" / "no versioned section" | E03 |
| "frontmatter.yaml" / "_overrides" / "substitution map" | E15 |
| "apps-client" / "vendored" / "missing import" | E27 |
| "screenshot" / "README.md in screenshots" | E10 |

If neither `--fixes` nor inline feedback is present, ask the user to paste the
feedback from the marketplace review card. This is the only interactive turn
in the `:revise` flow.

---

## Step 2 — route each code to the right specialist

Dispatch specialists based on code. Run in order; each specialist's output is
input to the next (e.g. `manifest-author` must run before re-rendering the
skill tree).

| Code | Specialist | What it does |
|---|---|---|
| E01 | `scripts/scaffold-marketplace-assets.mjs --slug {slug}` | Emits icon placeholder if still absent. |
| E03 | `release-checker` | Seeds the versioned CHANGELOG section. |
| E05 | `manifest-author` | Trims overlong fields using the char-cap table. |
| E10 | `ui-handler-author` / scaffold script | Removes `screenshots/README.md`; emits `00-overview.png` placeholder. |
| E15 | `ingest-prompt-author` | Emits `_overrides/frontmatter.yaml` with full substitution map per §4.4. |
| E27 | view-tool-builder rsync step | Vendors `apps-client` from canonical template. |
| Other | surface as-is | Log the code and the plain-English description; do not attempt to fix. |

Do NOT attempt to fix security findings (`S-*`), content-policy findings
(`CP*`), or test failures. Surface those to the user verbatim with:

> This finding needs your attention — it can't be addressed automatically.

---

## Step 3 — capture `revision_of` as a build-arg

Before running the build, read the `submission_id` from `last-submission.json`
and capture it as a state variable / build-arg:

```
revision_of = <submission_id from last-submission.json>
```

Do NOT attempt to patch `SUBMISSION.json` here — that file does not exist yet
at this point. If `SUBMISSION.json` is absent (e.g. `:revise` was called after
a build failure that occurred before stage 12 ran), fall through to a normal
`:build` with the same slug instead of continuing the revise flow.

Pass `revision_of` forward to step 5, which writes `SUBMISSION.json` from
scratch during stage 12.

**Do NOT bump `plugin.version`.** The prior submission never shipped to users;
bumping the version would create a version gap. The new submission carries the
same `plugin.version`, a different `tree_sha256` (because the files changed),
and a `revision_of` pointer. The marketplace dedup logic handles this correctly.

---

## Step 4 — re-run the build pipeline

After the specialist fixes are applied, run the same stage-7 pipeline as the
original build:

1. `scripts/scaffold-marketplace-assets.mjs --slug {slug}` (idempotent).
2. `manifest-author` — re-lint `listing.yaml` to confirm no E05 survivors.
3. `ingest-prompt-author` — re-render the skill tree if `_overrides/` changed.
4. `view-tool-builder` — re-run the view-tool build if any source changed.
5. `invariant-checker` — run all four pre-flight gates.

Skip specialists whose files were not touched by step 2. The goal is the
smallest diff from the prior submission tree — only the fixed files change.

If a specialist fails, apply the same retry rule as `07-build.md`: re-dispatch
with the error attached; after two failures escalate to `executor` (model=opus).

---

## Step 5 — advance to submission

Once the build passes all gates, proceed directly to stage 12 (`12-submit.md`).
Stage 12 creates `SUBMISSION.json` from scratch; when writing it, include the
`revision_of` value captured in step 3:

```json
{
  "revision_of": "<submission_id captured in step 3>"
}
```

This chains the new submission to the prior one in the marketplace worker's
database. Do not run stages 1–11 again.

Write the updated `last-submission.json` with the new `submission_id` once
the submission is confirmed (same rule as `07-build.md`).

---

## What you never do in `:revise` mode

- Don't greet, thank, or run stages 1–5.
- Don't bump `plugin.version`.
- Don't fix security or content-policy findings automatically.
- Don't run more than two specialist retries per code before escalating.
- Don't modify `last-submission.json` until the new submission is confirmed.
