# Stage 9.5 — synthesize test personalization

Stage 10 (sync iteration) only feels right when the sync prompt has the
same personalization context it would have in production. In a real
install, that context comes from `agntux-core`'s onboarding — `user.md`,
`data/instructions/{slug}.md`, `data/schema/contracts/{slug}.md`.
Without those, every issue Stage 10 surfaces is ambiguous: "is this a
prompt bug, or did onboarding never run?"

But onboarding is **owned by `agntux-core`, not by the source plugin
we're building.** The source plugin only advertises declarative
metadata in `marketplace/listing.yaml` (`tagline`, `purpose`,
`supported_prompts`, `proposed_schema`) and
`.claude-plugin/plugin.json` (`recommended_ingest_cadence`). Core's
per-plugin interview reads that metadata and produces the
personalization files at install time.

So this stage **doesn't run the user through an interview** (the user
is the contributor, not a real ingest user — asking them to roleplay a
new ingest setup they themselves authored is confusing and adds noise).
Instead, it synthesizes a plausible personalization context from a
shipped test persona plus the source plugin's listing metadata, shows
the contributor what was synthesized, and hands off to Stage 10.

Everything synthesized here stays **in conversation context only.**
Nothing is written to disk — not the user's real `data/`, and not a
scratch directory either. Stage 10 reads the synthesized blocks
directly from this conversation.

## What you do this stage

1. **Load the shipped test persona** from
   `${CLAUDE_PLUGIN_ROOT}/skills/build/fixtures/test-persona/`:
   - `user.md` — generic-but-plausible AgntUX user profile.
   - `schema/_seed.md` — minimal entity-subtype baseline.
   - `README.md` — explains what the fixture is for (you don't need
     to surface this to the contributor).

   Hold the contents in conversation context. Do not copy them to
   disk.

2. **Read the source plugin's `marketplace/listing.yaml`** at
   `plugins/agntux-{slug}/marketplace/listing.yaml` for these fields:
   - `tagline` — informs question phrasing
   - `description` and any `purpose` block — informs the
     fit-to-situation tailoring
   - `supported_prompts` — examples of what sync should produce
   - `proposed_schema` — extends the seed schema (entity subtypes,
     action classes, cursor semantics, source_id format)

   Failure modes (mirror the "Per-plugin onboarding interview" section
   of `plugins/agntux-core/skills/agntux/reference/onboard.md` — search
   for the `listing-yaml-malformed` learnings-log paragraph):
   - File missing → treat every field empty; proceed with generic
     synthesis.
   - YAML malformed → note the issue in conversation and proceed with
     every field empty.
   - Individual field missing → treat that field empty; the rest
     still apply.

3. **Read the source plugin's `.claude-plugin/plugin.json`** for
   `recommended_ingest_cadence`. Default to `Daily 04:00` if absent.

4. **Read the canonical per-plugin interview shape** from
   `plugins/agntux-core/skills/agntux/reference/onboard.md`. Locate
   the section titled "Per-plugin onboarding interview" and use its
   5-question shape as the template:
   1. Intent
   2. Always raise
   3. Usually ignore
   4. Fit to your situation
   5. Source-specific quirk

   Read this fresh every run so when core's interview evolves, the
   synthesis inherits it without re-rendering anything.

5. **Synthesize answers as the test persona.** Impersonate the
   loaded `user.md` persona (PM at a fictional B2B SaaS) and produce
   plausible answers for each of the 5 questions, conditioned on the
   source plugin's listing metadata. Examples of the synthesis shape:
   - Slack source: "Always raise: threads where someone @-mentions
     me asking for a decision; messages in #platform-leadership."
   - Gmail source: "Always raise: emails from leadership asking for
     a decision; customer-escalation threads where I'm tagged."
   - Jira source: "Always raise: tickets assigned to me with
     `blocking-release`; escalations linked to active customers."

   The persona's `# Preferences > ## Always action-worthy` and
   `## Usually noise` sections give you the universal baseline;
   adapt to the source's specific vocabulary using the listing
   metadata.

6. **Produce three in-conversation blocks** Stage 10 will reference:

   **Block A — simulated `user.md`** (verbatim from the persona,
   possibly with the source name added to `# Sources` if it wasn't
   already there).

   **Block B — simulated `data/instructions/{plugin-slug}.md`**, shape
   per the canonical instructions-file frontmatter described in
   `onboard.md`'s "Per-plugin onboarding interview" pre-step:
   ```
   ---
   type: plugin-instructions
   plugin: agntux-{slug}
   schema_version: "1.0.0"
   updated_at: <ISO 8601 UTC, computed at run time>
   authored_by: agntux-build:stage-9.5
   status: final
   ---

   # Always raise
   - <synthesized rule> (source: <YYYY-MM-DD> test-synthesis)
   - ...

   # Never raise
   - <synthesized rule> (source: <YYYY-MM-DD> test-synthesis)
   - ...

   # Rewrites

   # Notes
   - Source: {source-display-name}
   - Tagline: {tagline if present}
   - discovery_summary: <from persona>
   ```

   **Block C — simulated `data/schema/contracts/{plugin-slug}.md`**,
   composed from `schema/_seed.md` + `listing.yaml → proposed_schema`.
   Near-deterministic transformation: copy the seed, append the
   source-specific entity subtypes, narrow the action `reason_class`
   enum to what the source's `proposed_schema → action_classes`
   declares, document the cursor semantics and `source_id_format`.

7. **Show the contributor a one-screen summary** of what got
   synthesized. Plain language, no internal vocabulary. Example:

   > {Name}, before we test sync I've set up a fake user profile so
   > your plugin has realistic personalization to work against. Here's
   > the gist:
   >
   > - **Test persona**: PM at a fictional B2B SaaS company,
   >   managing a platform roadmap across three teams.
   > - **What they want from {source-display-name}**:
   >   {one-sentence intent}
   > - **Always surface**: {2 bullets, plain language}
   > - **Usually ignore**: {2 bullets, plain language}
   > - **Entity types from your `proposed_schema`**:
   >   {comma-separated subtype names}
   >
   > Looks reasonable? You can: **accept** and move on to sync,
   > **edit** any of these (say what to change), or **regenerate**
   > if it doesn't fit your source.

   Three signals to honour:
   - **accept** → save state and load
     [`10-sync-iterate.md`](10-sync-iterate.md).
   - **edit** → take the user's specific change ("make the
     usually-ignore list include CI bots", "the entity types should
     also cover `channel`") and revise the affected block. Re-show.
   - **regenerate** → resample the synthesis from scratch (different
     phrasings, maybe a different persona variant if a sibling fixture
     exists under `fixtures/test-persona-{variant}/`).

   Cap at 3 revisions. After 3, say so honestly and let the
   contributor either accept what's there or explicitly skip Stage 10:

   > Three revisions in. Want to move on with this setup (accept), or
   > skip the sync test entirely and jump to the triage UI test? If
   > sync personalization is the bottleneck, the underlying issue may
   > be that your `listing.yaml -> proposed_schema` block needs more
   > shape — that's a stage-5 / spec question, not a stage-9.5 one.

   - **accept** → continue as in the normal accept path.
   - **skip** → save state with `sync_test_skipped: true`, do NOT load
     `10-sync-iterate.md`, jump directly to
     `11-triage-ui-test.md`. The triage UI test still validates the
     end-to-end render path, so the plugin isn't shipping unvalidated.

8. **Save state** to the session record:
   ```json
   {
     "onboarding_mode": "synthesized",
     "persona_fixture_version": "<agntux-build version>",
     "synthesis_revisions": <int, 0–3>,
     "synthesized_at": "<ISO 8601>",
     "sync_test_skipped": <bool, true only when the contributor chose 'skip' at the 3-revision cap>
   }
   ```

   Always write the session record before transitioning — whether the
   contributor accepted, skipped, or the synthesis converged cleanly
   on the first try. A resume that finds `onboarding_mode:
   "synthesized"` and no `sync_test_skipped` falls forward to Stage 10;
   a resume with `sync_test_skipped: true` falls forward to Stage 11.

## What's deliberately not here

- **No interview of the contributor.** They authored the plugin
  metadata; running them through a 5-question interview shaped by
  that metadata would be circular. The synthesis stands in for an
  imagined typical user.
- **No scratch directory.** The synthesized blocks live in conversation
  context. Stage 10 reads them from there. The user's real `data/`
  stays untouched and no `.agntux-build/sessions/{id}/sync-output/`
  directory gets created by this stage.
- **No skip-path.** Every source plugin gets synthesized
  personalization. The earlier "this plugin defines no onboarding" path
  was based on a wrong assumption that source plugins owned onboarding
  in the first place.
- **No iteration on the plugin's prompts during this stage.** Onboarding
  prompts don't live in the source plugin — they live in `agntux-core`.
  If the contributor wants to influence how core's per-plugin interview
  phrases its questions for their source, that's a `listing.yaml`
  refinement (improving `tagline`, `purpose`, `proposed_schema`), which
  belongs back at stages 1–5, not here.

## Resume rule

If a prior session was interrupted mid-9.5, regenerate the synthesis
fresh on resume. The synthesis is cheap (a few reads + an LLM
composition) and reproducible from the persona + listing metadata, so
there's no value in splicing partial state across runs. Reset
`synthesis_revisions` to 0 and re-show the summary.

## When this stage is done

The contributor accepted the synthesized personalization (or accepted
after revisions). Three in-conversation blocks (`user.md`,
`instructions/{slug}.md`, `contracts/{slug}.md`) are held in context.
Session state records `onboarding_mode: "synthesized"`.

> Personalization ready. Now let's test sync against your real
> {connector-display-name} data — analyze-only, nothing gets written
> to your `data/` directory.

Load [`10-sync-iterate.md`](10-sync-iterate.md).

## What you do NOT do

- Don't copy the persona to the user's real `<agntux project root>/`.
  The persona stays in conversation context.
- Don't write `data/instructions/{slug}.md` or
  `data/schema/contracts/{slug}.md` to disk — those are Stage 10's
  inputs, held in conversation only.
- Don't ask the contributor the 5 interview questions yourself. The
  synthesis impersonates the persona; the contributor only sees the
  summary and accepts / edits / regenerates.
- Don't surface internal vocabulary ("synthesis", "fixture",
  "personalization context") in the summary. Say "fake user profile"
  or "test setup".
- Don't loop more than 3 revisions. If the synthesis can't land, the
  upstream issue is the plugin's listing metadata.
