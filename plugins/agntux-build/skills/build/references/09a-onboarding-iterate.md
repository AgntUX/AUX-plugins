# Stage 9.5 — onboarding test + iterate

Sync iteration (stage 10) only feels right when the plugin's onboarding
flow has run first — that's where personalisation values like role,
team scope, cadence, bootstrap window, and per-user filters get
captured. If we run sync against pure defaults, every issue we see is
ambiguous: "is this a prompt bug or did onboarding never happen?"

So before stage 10's first sync, we drive the plugin's own onboarding
flow inline (just like sync), iterate the prompts in `_overrides/` if
the questions land badly, and only then move on.

If the plugin doesn't define onboarding (some read-only sources have
no per-user personalisation), this stage announces that and falls
through to stage 10 with one sentence.

## Locate the onboarding flow

The canonical pattern (per `canonical/prompts/ui/skill-writer-discipline.md`
and `spec-writer-discipline.md → Section 14: Onboarding Flow`) puts
onboarding in one of these places, in priority order:

1. A `## Onboarding` section in the plugin's
   `skills/agntux-{slug}/SKILL.md`.
2. A dedicated `skills/agntux-{slug}/reference/onboarding.md`.
3. Embedded in the `## Onboarding commands` block of SKILL.md (rare —
   only if the prompt body is fully inline).

Read the rendered files on disk:

```
plugins/agntux-{slug}/skills/agntux-{slug}/SKILL.md
plugins/agntux-{slug}/skills/agntux-{slug}/reference/onboarding.md   # if present
```

Substitution has already been applied (these are post-render files),
so what you read is what the host would load after install.

## Skip-path: no onboarding defined

If neither location yields an onboarding flow, say so and pass through:

> {Name}, this plugin doesn't have a personalised onboarding step —
> the source doesn't need per-user setup beyond what we already
> captured at connector authorization. Skipping to sync.

Then load [`10-sync-iterate.md`](10-sync-iterate.md). Don't invent
onboarding questions to fill the gap; if the spec author decided no
onboarding was needed, that's an intentional choice (per spec-writer
§14: "Either populate the table OR write `## Onboarding Flow — Not
applicable` with a one-sentence rationale").

## Drive the onboarding flow inline

Same shape as the inline-sync shim from stage 10 — the build skill
plays the role the host would play after install:

1. **Read the rendered onboarding prompt.** Resolve the source from the
   priority list above.
2. **Set the expectation:**

   > {Name}, before we test sync I want to walk the onboarding flow
   > the plugin defines. It's {N} short questions and the answers
   > shape what sync surfaces — without them, sync runs on defaults
   > and we can't tell whether issues are prompt bugs or just an
   > unpersonalised setup. Should take a minute.

3. **Ask the questions.** Follow the onboarding prompt verbatim. Don't
   re-phrase, paraphrase, or skip questions — those edits belong in
   `_overrides/`, not in this conversation. If the prompt is unclear,
   that's a signal to iterate (see below), not a reason to wing it.

4. **Capture answers** to the configured destination. Per the canonical
   shape, that's one of:
   - `<scratch-root>/preferences.md` → `## Profile` section (universal
     keys: `status`, `asked_at`, `job_title`, `company_website`,
     `company_description`, `top_weekly_activities`, `team_structure`,
     `primary_tools`).
   - `<scratch-root>/preferences.md` → `## {App} preferences` section
     (app-specific keys per spec-writer §14(a)).
   - `<scratch-root>/data/agntux-{slug}/onboarding.md` (some plugins
     prefer a per-app file).
   - `<scratch-root>/preferences.md` → `## Onboarding` ledger only:
     `status: completed | deferred | skipped`, `asked_at`,
     `deferred_until`. `skipped` is permanent.

   `<scratch-root>` is the same scratch dir stage 10 will use:
   `<agntux-root>/.agntux-build/sessions/{session-id}/sync-output/`.
   Mirror any pre-existing `preferences.md` from the user's real root
   read-only — we want to see what's there but never overwrite the
   user's real personalisation file from the build session.

   **Resume policy.** If a prior session was interrupted mid-9.5, the
   scratch root may already contain a partial `preferences.md` with an
   `## Onboarding` ledger entry. On re-entry to 9.5, truncate that
   ledger to `status: in_progress` and clear any per-question answers
   captured in the prior run — restart cleanly rather than splicing
   answers across two runs. The captured-once `## Profile` block from
   stage 0 (contributor identity) is untouched; only the per-app
   `## Onboarding` and `## {App} preferences` sections reset.

5. **Confirm completion** in plain language:

   > Got it. {Brief restatement of one or two captured values that
   > will visibly shape sync — e.g. "I'll bias the first sweep toward
   > Eng-leadership channels and skip channels with zero @-mentions
   > in the last 30 days."}

## Iterate on the onboarding prompts

If the user gets confused, the questions don't fit their setup, or the
answers don't capture what sync needs, that's an iteration signal —
edit the onboarding prompt and re-run, same as a sync round.

Common signals:

- **Question is ambiguous.** "Wait, what counts as my team?" → the
  question needs a clarifying example. Add it to the prompt.
- **Question is too narrow.** Multi-select needed where single was
  offered, or vice versa. Edit the prompt's option shape.
- **Question doesn't apply to this user.** "I'm not a manager so the
  team-structure question doesn't fit" → either add a skip-branch or
  rephrase to be role-agnostic.
- **Captured value can't shape sync.** If you can't trace from a
  captured key to a concrete sync filter, the question isn't earning
  its place — drop it or rewrite.

Where to edit (same `_overrides/` system stage 10 uses):

- `_overrides/reference/onboarding.md` — full replacement of the
  canonical onboarding body (if a canonical default exists).
- `_overrides/onboarding-append.md` — append-only extension at the
  canonical `<!-- append:onboarding -->` marker.
- `_overrides/frontmatter.yaml` — add or rename onboarding question
  IDs that the canonical template substitutes into.

After each edit:

```
node scripts/render-skill.mjs agntux-{slug}
```

Then re-read the rendered onboarding file and re-run the round. Cap at
2 iterations on onboarding — it's usually fine after one fix, and any
deeper ambiguity is a sync-skill issue (which stage 10 catches anyway).

**The generalization checklist applies here too** — re-read the
"Generalization checklist" section of `10-sync-iterate.md` before
editing onboarding prompts. The same trap applies: easy to bake one
user's role/setup into the question wording. Phrase questions so the
next user with this connector recognises themselves in them.

## When onboarding is "good enough"

The user finished the questions, the captured values are in the
expected file, and the next round of sync should have personalisation
values to honour. That's it.

> Onboarding done. Now let's test sync against your real
> {connector-display-name} data.

Then load [`10-sync-iterate.md`](10-sync-iterate.md).

## Saved state at end of stage 9.5

```json
{
  ...,
  "onboarding_present": true,
  "onboarding_completed": true,
  "onboarding_iterations": 1,
  "onboarding_completed_at": "2026-05-08T...",
  "onboarding_capture_path": "/Users/.../.agntux-build/sessions/{session-id}/sync-output/preferences.md"
}
```

For the skip-path:

```json
{
  ...,
  "onboarding_present": false,
  "onboarding_completed": false,
  "onboarding_skip_reason": "plugin defines no onboarding (read-only source)"
}
```

## What you do NOT do

- Don't invent onboarding questions when the plugin's spec says
  "Not applicable". The spec author had a reason; respect it.
- Don't write captured answers to the user's real `data/` or
  `preferences.md`. Everything goes under the scratch root, same as
  stage 10. The user's real personalisation file stays untouched
  during the build session.
- Don't condense or paraphrase the questions. If a question reads
  badly, edit the prompt, re-render, re-ask — that's the iteration
  loop's whole point.
- Don't skip the generalization check. An over-fitted onboarding
  question is just as bad as an over-fitted sync filter.
- Don't loop more than 2 rounds on onboarding. Deeper issues belong
  to stage 10 (sync) or stage 5 (UI/spec).
