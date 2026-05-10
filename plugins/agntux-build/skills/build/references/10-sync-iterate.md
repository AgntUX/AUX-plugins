# Stage 10 — sync iteration (the load-bearing one)

This is where the plugin gets actually good. The build skill drives
sync against the user's real {connector-display-name} data **inline,
in the same Cowork thread** — no zip install needed for the iteration
loop. Each round we observe the run, identify issues, edit prompts on
disk, re-render, and re-run. It usually takes 3 to 5 rounds.

**Set the expectation explicitly before starting.** The cycle is
genuinely tedious; framing it as "the work that matters" rather than
"more steps" is what gets the user through it.

## Why inline (and not "install the zip and paste output back")

Stage 9 dropped a snapshot zip in `~/Downloads/`. We don't need it
yet — the rendered sync skill is on disk at
`plugins/agntux-{slug}/skills/agntux-{slug}/SKILL.md` (and its
`reference/` siblings). That's exactly the same file the host would
load if the plugin were installed. We can read it and execute its
steps directly against the source MCP tools that are already
authorized in Cowork (the user authorized them in stage 3). Iteration
becomes: edit `_overrides/`, re-render, re-run sync — no rebuild, no
reinstall, no manual paste loop.

The user only installs the zip later — at stage 11 (triage UI test) or
stage 12 (final submission).

## The opening setup

> {Name}, this next part is the single most useful thing we'll do
> together. The plugin works against mock data, but real data has
> capitalisation quirks, weird threading edge cases, sync volume
> we can't predict. Three to five rounds is what turns a 70%-good
> plugin into one that just works.
>
> I'm going to drive sync against your real {connector-display-name}
> data right here in the chat — no install needed yet. We'll iterate
> on prompts, you'll tell me what looks right and what doesn't, and
> at the end you'll have a plugin that fits how you actually work.

## Inline-execution shim — what the build skill does each round

For each round, the build skill plays the role the host would play
after install:

1. **Read the rendered sync skill on disk.**
   ```
   plugins/agntux-{slug}/skills/agntux-{slug}/SKILL.md
   plugins/agntux-{slug}/skills/agntux-{slug}/reference/sync.md
   plugins/agntux-{slug}/skills/agntux-{slug}/reference/fetch.md
   plugins/agntux-{slug}/skills/agntux-{slug}/reference/cursor.md
   plugins/agntux-{slug}/skills/agntux-{slug}/reference/compose-payload.md
   ```
   These are post-render files (substitution applied, append markers
   stripped). Same files the host would load.

2. **Resolve a scratch knowledge-store root** for the run:
   ```
   <agntux-root>/.agntux-build/sessions/{session-id}/sync-output/
   ```
   Pass this as the AgntUX project root for the inline run. The
   canonical sync skill resolves all writes (`data/learnings/...`,
   `data/agntux-{slug}/...`, cursors, knowledge entries) relative to
   that root, so the user's real `data/` directory stays clean. Mirror
   any existing `preferences.md` / `user.md` from the real root by
   reading-only — we want the personalisation values, not new writes.

3. **Execute sync steps 0–11 inline.** The procedural body in
   `reference/sync.md` is the same set of steps the host runs after
   install. Dispatch each step in this conversation, calling the source
   MCP tools (`mcp__jira_*`, `mcp__slack_*`, `mcp__gmail_*`, etc.) that
   are already authorized in Cowork. The build skill is the
   orchestrator; the sync skill's steps are the procedure.

4. **Capture the run output** — every tool call, every result, every
   write to the scratch knowledge store. The build skill sees all of
   this in its own context. No paste loop required.

5. **Read the run as user input** — same signal-reading we'd do on a
   pasted run, applied directly to what we just observed (see the
   signal table below).

## What you do with the captured run

The build skill has the full run output in context. Look for these
specific signals:

### Sync output signals

- **Action items raised that shouldn't have been.** Slackbot reminders
  surfacing as response-needed → fix the upstream filter rule.
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
- **Duplicate entities.** Two `Jane Smith` entries → fix alias
  resolution or `_sources.json` lookup-before-write.

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

## How you respond after each round

1. Lead with one sentence acknowledging the round. Concrete and
   specific:

   > Round 1 done. {N-action-items-raised} action items, {M-entities}
   > new entities. Two things stood out — {issue-1-summary} and
   > {issue-2-summary}.

2. Translate each issue to plain language and propose the fix:

   > For the @-mention thing: the channel discovery wasn't including
   > private channels you've authored in. I'll add that to the
   > discovery sweep. Easy fix.

3. **Apply the generalization checklist (see next section)** before
   touching any prompt file. This is where most rounds get over-fit to
   one user's data; the checklist exists to stop that drift.

4. Edit the prompts. Use the same internal specialists from stage 7
   (silently — the user doesn't see specialist names). Most fixes
   live in:
   - `_overrides/reference/fetch.md` (sync logic — must generalize)
   - `_overrides/frontmatter.yaml` (cadence, bootstrap window,
     volume cap — sensible defaults)
   - `_overrides/{step-id}-append.md` (extra rules at named steps —
     must generalize)
   - The view tool's structuredContent shape (UI fixes — rare here;
     stage 11 handles those).

5. **Re-render the skill tree** so the on-disk rendered files reflect
   the override changes:
   ```
   node scripts/render-skill.mjs agntux-{slug}
   ```
   No `build-plugin.mjs` rebuild needed — the sync skill is pure
   markdown. The MCP server bundle is unchanged between rounds.

6. **Re-run sync inline** against the same scratch root. Compare
   round-N output to round-(N-1) output and report what changed.

## Generalization checklist (read before every prompt edit)

The danger of this loop is over-fitting prompts to one user's data —
e.g., adding `denylist: [#random, #pets, #foosball]` because *this*
user's Slack has those noisy channels, then shipping a plugin that
silently skips channels named `#pets` for everyone else.

**Before you propose any prompt edit, ask:**

1. Is this fix specific to *this user's* {connector-display-name}
   setup, or would it help the next user with the same connector?
2. If it's a denylist entry, can you re-phrase it as a *rule* (e.g.,
   "skip channels with no human messages in 30 days") rather than a
   hardcoded list?
3. If it's a personalization tweak (timezone, locale, role-specific
   filter, cadence), does it belong in `_overrides/frontmatter.yaml`
   so the next user gets a sensible default but can override?
4. **If the fix is genuinely user-specific** (one-off Slackbot
   variant, this user's Jira workflow, etc.), do NOT bake it into the
   plugin. Note it as a candidate for the user's local `_overrides/`
   in their installed copy and move on.

**Rule of thumb:**

- Edits to canonical fetch / cursor / compose-payload logic must
  generalize across users.
- Edits to `_overrides/frontmatter.yaml` may carry sensible defaults
  (bootstrap window, cadence, volume cap) — defaults, not constants.
- Edits to `_overrides/{step-id}-append.md` must read as universal
  rules ("skip messages where author === 'Slackbot'"), not as
  enumerations of one user's data.
- User-specific tweaks belong in the user's own installed copy, not
  the shipped plugin.

When in doubt, say it out loud to the user:

> That looks specific to your setup — channels you happen to be in.
> If we bake it in, it'll only help you. Want me to make this a
> rule the plugin can apply for any user (e.g., "skip channels
> with no @-mentions in 30 days") instead?

The user almost always says yes once it's framed that way.

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
> next thing to test is the action buttons themselves, in the
> triage UI — for that we'll install the zip and run it once
> end-to-end.

## Saved state at end of stage 10

```json
{
  ...,
  "inline_sync_scratch_dir": "/Users/.../.agntux-build/sessions/{session-id}/sync-output/",
  "sync_iterations": [
    {
      "round": 1,
      "ran_at": "...",
      "issues_found": ["channel-discovery", "alias-resolution"],
      "fix_summary": "added private-channel sweep + universal alias lookup (no hardcoded names)",
      "generalization_check": "passed — alias rule applies to any user with display-name+email shape"
    }
  ],
  "sync_iteration_count": 4,
  "sync_marked_good_enough_at": "2026-05-08T..."
}
```

## Fallback: when inline sync isn't possible

A small set of cases force the install-then-run flow:

- **The source MCP isn't reachable from Cowork** (e.g., user is on a
  host without that connector) — even though stage 3 should have caught
  this, occasionally a connector is auth'd but the MCP isn't wired in.
- **The sync skill needs a host capability** the build skill can't
  fake (e.g., direct host-renderer iframe interaction during sync).

When this happens:

1. Tell the user honestly: "I can't drive the connector from in here
   for {reason}. Let's switch to install-and-run mode for this plugin."
2. Walk the install — use the eight-click install steps documented in
   `11-triage-ui-test.md → Regenerate and install` (stage 11 owns the
   install walk now; load that section verbatim).
3. Have the user run `/agntux-{slug}` in this same Cowork conversation
   and paste the expanded run output back.
4. Continue the iteration loop with paste rounds. Re-render after each
   prompt edit; have the user re-zip via `node scripts/build-plugin.mjs
   agntux-{slug}` (with a patch-version bump per stage 11's fail-closed
   rule) and reinstall ("Reinstall from file" in Personal Plugins)
   before each subsequent round.

This fallback should be rare. If the inline path works on the first
attempt, prefer it.

## What you do NOT do

- Don't bake user-specific data into prompts. Re-read the generalization
  checklist if you're unsure.
- Don't try to short-circuit the loop ("looks fine, skip the next
  round"). The user's instinct on "good enough" is what matters,
  not yours.
- Don't expose specialist names ("calling source-semantics-advisor
  for the threading fix"). Talk in user-visible terms.
- Don't bump major or minor versions for these fixes — they're
  patches.
- Don't write to the user's real `data/` directory during iteration.
  All inline-sync writes go to the scratch root under
  `.agntux-build/sessions/{session-id}/sync-output/`.
- Don't ask the user to reinstall a zip between rounds in the inline
  path. That's the legacy flow; the inline path makes reinstall
  unnecessary.
