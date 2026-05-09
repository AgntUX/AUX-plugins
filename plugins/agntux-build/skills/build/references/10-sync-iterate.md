# Stage 10 — sync iteration (the load-bearing one)

This is where the plugin gets actually good. The user runs
`/agntux-{slug} sync` against their real {connector-display-name}
data, the run produces real outputs and real surprises, and we read
the run, identify issues, regenerate the zip, and the user re-runs.
It usually takes 3 to 5 rounds.

**Set the expectation explicitly before starting.** The cycle is
genuinely tedious; framing it as "the work that matters" rather than
"more steps" is what gets the user through it.

## The opening setup

> {Name}, this next part is the single most useful thing we'll do
> together. The plugin works against mock data, but real data has
> capitalisation quirks, weird threading edge cases, sync volume
> we can't predict. Three to five rounds of running and pasting
> back is what turns a 70%-good plugin into one that just works.
>
> Here's the flow we'll loop through:
>
> 1. Open **Cowork**.
> 2. Type `/agntux-{slug} sync` and run it. The first run sweeps
>    a {bootstrap-window} window of your data — could take a
>    minute or two.
> 3. When the run finishes, **expand every collapsed section**.
>    Specifically:
>    - Used a skill
>    - Result
>    - Running command
>    - Script
>    - Show more (anywhere it appears)
>    - {Connector-display-name} tool Result
> 4. Highlight everything from top to bottom.
> 5. Paste it here.
>
> The point of expanding everything is so I see what the plugin
> actually did, not the host's summary view. I'll read the whole
> thing, find what's off, edit the prompts, regenerate the zip,
> and you'll re-upload.

## What you do with the pasted run

Read the entire pasted output as user input. Look for these
specific signals:

### Sync output signals

- **Action items raised that shouldn't have been.** "I got a
  response-needed item for a Slackbot reminder" → add to the
  plugin's denylist or filter.
- **Action items NOT raised that should have been.** "I @-mentioned
  myself in #general at 9am and nothing surfaced" → expand the
  channel discovery or fix a filter.
- **Wrong subtype on an entity.** A person was filed under
  `company` → fix the entity-classification logic in
  `_overrides/reference/fetch.md`.
- **Threads not associating.** Replies to old threads aren't being
  caught → bring up the parent-tracked-threads pattern with
  `source-semantics-advisor`.
- **Volume exploded.** "First run pulled 3000 messages" → tighten
  bootstrap window in `_overrides/frontmatter.yaml` or add a
  `volume_cap_per_run` setting.
- **Duplicate entities.** "I see two `Jane Smith` entries" → fix
  alias resolution or `_sources.json` lookup-before-write.

### Connector-tool-call signals

- **Tool returned auth error.** Connector permission missing →
  redirect to host's connector page.
- **Tool returned rate-limit error.** Pace down the cadence.
- **Tool returned data the prompt didn't expect.** New shape from
  the connector → patch the parser in `fetch.md`.

### Cost / latency signals

- **Single run took 15+ minutes.** Tighten the parallelism, the
  cap, or the bootstrap window.
- **Single run cost > $1 in tokens.** Same.

## How you respond after each paste

1. Lead with one sentence acknowledging the round. Concrete and
   specific:

   > Round 1 done. {N-action-items-raised} action items, {M-entities}
   > new entities. Two things stood out — {issue-1-summary} and
   > {issue-2-summary}.

2. Translate each issue to plain language and propose the fix:

   > For the @-mention thing: the channel discovery wasn't
   > including private channels you've authored in. I'll add that
   > to the discovery sweep. Easy fix.
   >
   > For the duplicate Jane: alias resolution wasn't matching
   > display name + email; we'll add an "or-alias" lookup before
   > writing.

3. Edit the prompts. Use the same internal specialists from stage 7
   (silently — the user doesn't see specialist names). Most fixes
   live in:
   - `_overrides/reference/fetch.md` (sync logic)
   - `_overrides/frontmatter.yaml` (cadence, bootstrap window,
     volume cap)
   - `_overrides/{step-id}-append.md` (extra rules at named steps)
   - The view tool's structuredContent shape (UI fixes — rare here;
     stage 11 handles those).

4. Regenerate the zip:

   ```
   node scripts/build-plugin.mjs agntux-{slug}
   ```
   Then re-zip into the same submissions path with a bumped patch
   version (`0.1.0` → `0.1.1` → `0.1.2`).

5. Tell the user to re-upload:

   > New zip at {path}. Same install flow as before — Customize →
   > Personal Plugins → click `agntux-{slug}` → there's a "Reinstall
   > from file" option. Drag the new zip in and confirm.

6. Once they confirm reinstall, ask them to re-run sync and paste
   back.

## Iteration cadence and gates

After round 3, check in:

> {Name}, three rounds in. How are you feeling — close, or still
> needs work? No wrong answer.

After round 5:

> Five rounds. Usually we land it by here. Want to step back and
> tell me what's still feeling off, or call this v0.1 and iterate
> live after we see it in your normal use?

If the user signals "good enough", advance to stage 11. If they
want more rounds, do them — but watch fatigue and offer a break.

## When the sync is "good enough"

Define explicitly: the user can use the plugin in their daily
flow without flinching. Not perfect — *good enough*.

> Calling it. The plugin is now syncing your
> {connector-display-name} data into your knowledge store the way
> it should. Action items are raising for the right things. The
> next thing to test is the action button itself, in the triage
> UI — that's a quick check.

## Saved state at end of stage 10

```json
{
  ...,
  "sync_iterations": [
    {
      "round": 1,
      "user_run_pasted_at": "...",
      "issues_found": ["channel-discovery", "alias-resolution"],
      "fix_summary": "added private-channel sweep + alias lookup",
      "new_version": "0.1.1"
    },
    ...
  ],
  "sync_iteration_count": 4,
  "sync_marked_good_enough_at": "2026-05-08T..."
}
```

## What you do NOT do

- Don't ask the user to copy the run from terminal output. Cowork
  is the source of truth — the host renders the run with the
  expandable sections we need.
- Don't try to short-circuit the loop ("looks fine, skip the next
  round"). The user's instinct on "good enough" is what matters,
  not yours.
- Don't expose specialist names ("calling source-semantics-advisor
  for the threading fix"). Talk in user-visible terms.
- Don't bump major or minor versions for these fixes — they're
  patches.
