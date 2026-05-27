# Stage 10 — sync iteration (analyze-only)

This is where the plugin gets actually good. The build skill drives
sync against the user's real {connector-display-name} data **inline,
in the same Cowork thread, and analyze-only** — no install, no
scratch directory, no writes to disk. Each round we pull data, run
the compose logic, summarize what sync *would* produce, identify
issues, edit prompts on disk, re-render, and re-run. It usually takes
3 to 5 rounds.

**Set the expectation explicitly before starting.** The cycle is
genuinely tedious; framing it as "the work that matters" rather than
"more steps" is what gets the user through it.

## Why inline-and-analyze-only

No install is needed for this loop — the plugin isn't packaged until
stage 12. The rendered sync skill is already on disk at
`plugins/agntux-{slug}/skills/agntux-{slug}/SKILL.md` (and its
`reference/` siblings). That's exactly the same file the host would
load if the plugin were installed. We can read it and execute its
steps directly against the source MCP tools that are already
authorized in Cowork (the user authorized them in stage 3).

**The build session never writes sync artifacts to disk.** No
entities, no actions, no learnings/cursor file, no scratch directory.
The build assistant runs the compose logic in conversation and prints
structured tables of what sync *would* produce. The contributor's
real `<agntux project root>/data/` directory stays untouched
end-to-end. Iteration becomes: edit `_overrides/`, re-render, re-run
analyze-only sync — no rebuild, no reinstall, no manual paste loop,
no residue.

The plugin's first real run happens once the AgntUX team deploys it
to the remote MCP server. Stage 12 finalizes the plugin and the
AgntUX desktop app syncs it to the team automatically; there is no
local install step for source plugins (Claude Cowork's local-stdio
path is broken for view tools).

## The opening setup

> {Name}, this next part is the single most useful thing we'll do
> together. The plugin works against mock data, but real data has
> capitalisation quirks, weird threading edge cases, sync volume
> we can't predict. Three to five rounds is what turns a 70%-good
> plugin into one that just works.
>
> I'm going to pull your real {connector-display-name} data right here
> in the chat — no install needed yet — and walk you through exactly
> what your plugin's sync prompt would do with it. Analyze-only:
> nothing gets written to your AgntUX data store. You'll tell me what
> looks right and what doesn't, and at the end you'll have a plugin
> that fits how you actually work.

## Inline-execution shim — what the build skill does each round

For each round, the build skill plays the role the host would play
after install, with one critical difference: every would-be write is
captured as in-conversation state instead of being persisted to disk.

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

2. **Use the synthesized personalization from stage 9.5 as the
   project-root equivalent.** Stage 9.5 holds three blocks in
   conversation context: a simulated `user.md`, a simulated
   `data/instructions/{slug}.md`, and a simulated
   `data/schema/contracts/{slug}.md`. When the canonical sync prompt's
   Step 0 instructs you to "read the schema and instructions", read
   those conversation blocks rather than the user's real filesystem.
   Do NOT resolve a scratch directory under `.agntux-build/sessions/`
   — no directory gets created and nothing gets written for sync.

3. **Execute sync steps 0–11 inline in analyze-only mode.** The
   procedural body in `reference/sync.md` is the same set of steps the
   host runs after install. Dispatch each step in this conversation,
   calling the source MCP **read** tools (`mcp__jira_*`, `mcp__slack_*`,
   `mcp__gmail_*`, etc.) that are already authorized in Cowork. Every
   step that would normally write to disk gets captured as
   in-conversation state instead:

   | Canonical step | Would write to | Analyze-only behaviour |
   |---|---|---|
   | Step 2 (bootstrap learnings template) | `data/learnings/{{slug}}/sync.md` | Initialize an in-memory `learnings` object with `cursor: null`, `last_run: null`, `items_processed: 0`, `errors: []`. No file write. |
   | Step 3 (acquire lock) | `data/learnings/{{slug}}/sync.md` | Skip the lock entirely — there's no shared state to guard against. |
   | Step 6 (create entity) | `entities/{subtype}/{slug}.md` | Append `{action: "create", subtype, slug, frontmatter, body_sections}` to the in-memory `would_create_entities[]` list. |
   | Step 7 (update entity) | `entities/{subtype}/{slug}.md` | Append `{action: "update", subtype, slug, diff_summary}` to `would_update_entities[]`. |
   | Step 8 / 8.5 / 8.6 / 9 / 10 (action writes — deferred / drained / merged / fresh / auto-resolved) | `actions/{YYYY-MM-DD}-{slug}.md` | Append `{action_class, id, status, priority, reason_class, source_ref, related_entities, body_summary}` to the matching list (`would_create_actions[]`, `would_defer_actions[]`, `would_resolve_actions[]`, `would_merge_actions[]`). |
   | Step 11 (advance cursor, update learnings) | `data/learnings/{{slug}}/sync.md` | Compute the cursor diff (keys added / advanced / evicted) and `items_processed` increment as in-memory state. No file write; no lock release. |

   The source MCP **write** tools (`*_send_message`, `*_create_issue`,
   `*_create_draft`) are never called — same contract as
   `canonical/prompts/ingest/skills/sync/reference/ask.md`'s read-only
   rule. If a source plugin's compose-payload step would normally
   prepare a draft for a write tool, capture the payload in-memory and
   move on; do not invoke the write tool.

4. **Capture the run output as a structured summary.** After the
   inline execution finishes, the build skill has six in-memory lists:
   `would_create_entities`, `would_update_entities`,
   `would_create_actions`, `would_defer_actions`,
   `would_resolve_actions`, `would_merge_actions`, plus the cursor
   diff and `items_processed` count. Format these into a
   contributor-facing summary (see "How you respond after each round"
   below). Nothing else is captured to disk.

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

   > Round 1 done. {N-actions-would-raise} action items would have been
   > raised, {M-entities-would-create} new entities would have been
   > created. Two things stood out — {issue-1-summary} and
   > {issue-2-summary}.

   Then print the structured tables from the in-memory state:

   **Entities that would be created**

   | Subtype | Slug | Key facts |
   |---|---|---|
   | person | jane-smith | first_seen: 2026-04-12; sources: [slack, gmail] |
   | … | … | … |

   **Entities that would be updated** (diff summary, not full content)

   | Subtype | Slug | What changed |
   |---|---|---|
   | project | platform-v2 | last_active advanced 2026-05-01 → 2026-05-09; appended 3 signals |
   | … | … | … |

   **Action items that would be raised**

   | Priority | Reason class | Source ref | Why this matters (one line) |
   |---|---|---|---|
   | p1 | response-needed | slack://C123/p456 | EM-A asked a yes/no decision; thread has 4 follow-ups without you |
   | … | … | … | … |

   **Cursor diff** (keys added / advanced / evicted; no write).
   **Items processed**: N.

   The three buckets above (would-create entities, would-update
   entities, would-raise actions) are always shown. The other three
   buckets — `would_defer_actions`, `would_resolve_actions`,
   `would_merge_actions` — are typically empty on a first run; render
   them only when non-empty, with the same one-line-per-row shape.
   Cap each table at the first 10 rows; if more, append a "+ N more"
   row. The contributor needs enough to read signal, not a wall of
   data.

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
   - The view tool's structuredContent shape (UI fixes — rare at this
     stage; stage 6's headed-renderer loop is where UI iteration
     happens. If a sync round surfaces a UI gap, loop back briefly).

5. **Re-render the skill tree** so the on-disk rendered files reflect
   the override changes:
   ```
   node scripts/render-skill.mjs agntux-{slug}
   ```
   No `build-plugin.mjs` rebuild needed — the sync skill is pure
   markdown. The MCP server bundle is unchanged between rounds.

6. **Re-run sync inline** in analyze-only mode using the same
   synthesized personalization from stage 9.5. Compare round-N output
   tables to round-(N-1) and report what changed (delta in
   would-create entities, would-raise actions, cursor advancement).

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

If the user signals "good enough", advance to stage 12. If they
want more rounds, do them — but watch fatigue and offer a break.

## When the sync is "good enough"

Define explicitly: the user can use the plugin in their daily
flow without flinching. Not perfect — *good enough*.

> Calling it. The plugin's sync prompt is producing the right
> entities and action items for your {connector-display-name} data —
> based on the analyze-only runs we just walked through. Once the
> AgntUX team deploys the plugin to the remote MCP server, sync
> will actually write to your knowledge store on the cadence in
> `recommended_ingest_cadence`. The action buttons you designed in
> stage 6 will be live then too. Last step: signing the submission
> and finalizing it for sync.

## Saved state at end of stage 10

```json
{
  ...,
  "dry_run": true,
  "sync_iterations": [
    {
      "round": 1,
      "ran_at": "...",
      "simulated_entity_creates": 14,
      "simulated_entity_updates": 23,
      "simulated_action_creates": 6,
      "simulated_action_defers": 2,
      "simulated_action_resolves": 0,
      "simulated_action_merges": 1,
      "simulated_cursor_advance": "advanced 3 keys; evicted 1",
      "items_processed": 187,
      "issues_found": ["channel-discovery", "alias-resolution"],
      "fix_summary": "added private-channel sweep + universal alias lookup (no hardcoded names)",
      "generalization_check": "passed — alias rule applies to any user with display-name+email shape"
    }
  ],
  "sync_iteration_count": 4,
  "sync_marked_good_enough_at": "2026-05-08T..."
}
```

The session record is itself a file under
`<agntux project root>/.agntux-build/sessions/{session-id}.json` — that
write is fine (build-tooling state, not user data). What stays off-disk
is the sync output itself: entities, actions, learnings, cursors.

## Fallback: when inline sync isn't possible

A small set of cases prevent inline sync entirely:

- **The source MCP isn't reachable from Cowork** (e.g., user is on a
  host without that connector) — even though stage 3 should have caught
  this, occasionally a connector is auth'd but the MCP isn't wired in.
- **The sync skill needs a host capability** the build skill can't
  fake (e.g., direct host-renderer iframe interaction during sync).

When this happens, **escalate rather than try to install locally**.
Source plugins are remote-view-only — Claude Cowork's local-stdio
path is broken for view tools, so there is no path to "install and
run it locally" the way the legacy flow used to assume.

Tell the contributor:

> I can't drive {connector-display-name} from in here for {reason},
> and I can't ask you to install it locally (Claude Cowork's local
> plugin host is broken for view tools right now). The AgntUX team
> will need to deploy the plugin to the remote MCP server before
> sync gets its first real run. Want me to note this so the
> maintainers know to test end-to-end on their side? Or open an
> issue at https://github.com/AgntUX/AUX-plugins/issues with what
> you've got so far?

If the user picks "note this", add a `sync_untested: true` field to
the session JSON and mention in stage 12's wrap-up that sync wasn't
exercised inline so the maintainers test end-to-end after deploy.
Then advance to stage 12.

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
- **Don't write any sync artifact to disk.** No entities, no actions,
  no learnings/cursor, no scratch directory under
  `.agntux-build/sessions/{id}/sync-output/`. All would-writes are
  emitted as structured tables in the contributor-facing summary. The
  build session leaves zero filesystem residue from the sync pass
  itself. The session JSON at
  `.agntux-build/sessions/{id}.json` is the only sync-related write,
  and it carries summary counts only, not the entity/action content.
- **Don't call source MCP write tools.** Only read tools. Same
  contract as `canonical/prompts/ingest/skills/sync/reference/ask.md`.
- Don't ask the user to reinstall between rounds in the inline path.
  That's the legacy flow; the inline path makes reinstall
  unnecessary.
