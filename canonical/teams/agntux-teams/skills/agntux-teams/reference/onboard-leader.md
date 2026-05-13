# `/agntux-teams onboard:leader {view-slug}` — Leader-view onboarding

Lane: walk a leader-view owner through composing the cross-team
**relevance filter**, authoring the plain-English **alerting rules**
that drive synthesised action items, picking the **aggregate vs
pointer** bias, choosing the dispatch **cadence**, and registering
the leader-view scheduled task that runs the per-cycle synthesis pass
(see `/agntux-teams sync leader:{view-slug}` in `reference/sync.md`).

## Step 0 — Preflight

Six gates, in order. Any failure stops the skill with the quoted
short message and **no file writes**.

1. **Parse `$ARGUMENTS`.** The first token is `{view-slug}`. Missing
   → emit "Usage: `/agntux-teams onboard:leader {view-slug}`" and
   stop.

2. **`user.md` gate.** If `<root>/user.md` is missing, emit "Run
   `/agntux onboard` first — the leader-view interview needs your
   personal AgntUX profile." and stop.

3. **Ownership.** Read
   `<root>/.agntux/teams.json.leader_views[]`. The row must exist
   with `owner: true` and `view_slug: {view-slug}`. Missing →
   emit "You don't own a leader view called `{view-slug}`. Org Admin
   creates leader views in
   `app.agntux.ai/org/{org-slug}/leader-views`." and stop.

4. **Subscriptions.** Resolve `{org-slug}` from `teams.json.org_slug`
   and call:

   ```
   GET https://app.agntux.ai/api/teams/{org-slug}/leader-views/{view-slug}/status
   ```

   Authenticate with `Authorization: Bearer {license_jwt from teams.json}`
   — same convention as the team-member onboarding API calls.
   The endpoint returns
   `{ subscribed_team_count, owner_user_id, subscribed_teams[] }`.
   - **`subscribed_team_count === 0`** → emit one
     `mcp__cowork__create_artifact` card titled "No teams subscribed
     yet" with body: "Your leader view **{display_name}** has no
     teams subscribed yet. Ask your Org Admin to add at least one
     team at
     `app.agntux.ai/org/{org-slug}/leader-views/{view-slug}`. Re-run
     `/agntux-teams onboard:leader {view-slug}` once subscriptions
     exist." Stop. **No writes.**
   - **HTTP 401 / 403 / network error** → emit "Couldn't reach the
     AgntUX Teams API. Check your AgntUX Teams desktop app is
     running and signed in, then re-run." and stop.
   - **`subscribed_team_count > 0`** → proceed.

5. **Subscribed-team readiness.** For each entry in
   `subscribed_teams[]`, confirm
   `<root>/teams/{team-slug}/data/team-config.md` exists locally
   with `onboarding_complete: true`. Any missing or
   `onboarding_complete: false` → emit a short list:

   ```
   Some subscribed teams aren't onboarded yet. Their team leads
   need to run `/agntux-teams onboard:team-lead {team-slug}` first:
     · {team-slug-1} (lead: {user-slug-1})
     · {team-slug-2} (lead: {user-slug-2})
   Re-run this command once they've finished.
   ```

   Stop. The rule-authoring step (Step 2b) needs each team's
   `schema.lock.json` to know which entity subtypes + action classes
   the rules can reference.

6. **Re-entry mode.** Check
   `<root>/leader-views/{view-slug}/data/view-config.md`.
   - **Absent** → first-run mode. Create the leader-view data root
     (see skeleton below) and proceed.
   - **Present + `onboarding_complete: true`** → edit mode. Emit
     "Leader view `{view-slug}` is already onboarded. Re-run will
     walk each step with your prior answers as defaults; producing
     no changes leaves the file untouched." Then proceed,
     pre-filling each step's answer from the existing frontmatter.

   First-run skeleton — write only after gates 1–5 pass. **Use empty
   sentinels** for every leader-chosen field so the re-entry path
   below can tell "leader has not answered yet" from "leader said
   this last time":

   ```yaml
   ---
   view_slug: <slug>
   view_id: <uuid-from-teams.json>
   display_name: <from-status-API-or-teams.json>
   owner_user_slug: <from teams.json.user_slug>
   subscribed_teams:
     - <team-slug-1>
   relevance_filter: ""
   aggregate_bias: ""
   cadence: ""
   cron: ""
   schema_version: "1.0.0"
   onboarding_complete: false
   onboarding_step: 0
   ---
   ```

   Create the sibling directories `<root>/leader-views/{view-slug}/actions/`
   and `<root>/leader-views/{view-slug}/data/` if absent.

   **Re-entry pre-fill rule.** Treat a frontmatter field as the
   leader's prior answer only when (a) its value is non-empty AND
   (b) `onboarding_step` is `≥` the step that captures that field
   (Step 2 ⇒ ≥ 2, Step 3 ⇒ ≥ 3, Step 4 ⇒ ≥ 4). Anything below that
   bar is a skeleton sentinel — ask the question fresh.

## Step 1 — Briefing card

Emit a single `mcp__cowork__create_artifact` card before any
question — the leader should see the full setup once, then answer.

Card title: `Leader view: {display_name}`

Body (substitute `{provisioned_by}` from the status-API response —
the Org Admin's `display_name`):

```
You're set up as the leader for **{display_name}**.
  · Subscribed teams: {team1 (lead: alice), team2 (lead: bob)}
  · Provisioned by: {provisioned_by}

A leader view shows you items synthesised across the teams you
subscribe to. Two action-item shapes both render every cycle:
  · **Aggregate** items: "three teams have an open question about X"
  · **Pointer** items: each team's item with a "from team Y" label
You'll bias toward one or the other in Step 3.

I'll walk you through five short questions:
  1. What you're watching for across these teams (the relevance filter).
  2. The specific alerting rules that should produce action items.
  3. Aggregate-vs-pointer bias.
  4. How often the view should refresh (cadence).
  5. Confirm + register the scheduled task.
```

No question yet — the briefing is read-only. Pause for the leader
to acknowledge (a "ready" / "ok" / silent continue) before Step 2.

## Step 2 — Cross-team relevance filter + alerting rules

### Step 2a — Anchor question (the relevance filter)

Ask, in one prompt:

> "When you look across **{display_name}**, what are you trying to
> see? Two or three sentences in your own words. Examples drawn
> from your subscribed teams' purposes:
>   · 'Customer pain points raised across all the product teams.'
>   · 'Blockers that span multiple teams.'
>   · 'Every customer escalation, anywhere.'
>
> (You can also paste a rougher description — I'll tighten it.)"

If the leader's free-text answer is shorter than ~12 words, ask one
clarifying follow-up: "Can you say a bit more about what kind of
items you'd want me to surface? Even a few extra words helps me
draft the rules in Step 2b." Otherwise proceed.

**Synthesis.** Compose a one-line summary of the answer (max 140
chars). Confirm with the leader: "I'll capture your watch as:
**'{one-line summary}'**. Sound right?" — single
`AskUserQuestion` with options `Yes, that's it` / `Let me reword`.
On `Let me reword`, accept the leader's edit verbatim. Persist as
`relevance_filter:` in the view-config frontmatter.

### Step 2b — Alerting rules walkthrough

The leader-view scheduled task (`reference/sync.md` → leader-view
pass) reads the rule body each cycle and writes fully-authored
action items. **Pointers are dropped per P7** — every leader-view
action is self-contained, not a thin link back to a team action.

Drive the rule-authoring conversationally — **never let the leader
type raw markdown**. For each rule, ask three short questions:

1. **Trigger.** "Describe one situation across {display_name} that
   should produce an action item for you. Two sentences. (You can
   reference team slugs like `{subscribed_teams[0]}` and concepts
   from your teams — customer entities, action statuses, sprint
   counts — I'll match them to the team schemas.)"
2. **Action body.** "When that fires, what should the action item
   tell you to do? One or two suggested next steps — e.g., 'name
   the customer + summarise the situation + suggest a personal
   outreach option'."
3. **Cadence.** Single `AskUserQuestion`:
   | Option | Stored cadence |
   |---|---|
   | As soon as the trigger appears (every cycle) | `every-cycle` |
   | At most once per rolling 7-day window | `weekly` |
   | At most once per rolling 14-day window | `biweekly` |
   | At most once per rolling 30-day window | `monthly` |

After the three answers, **synthesise the rule** into the canonical
shape from P7's "Leader-view content rules" section:

```markdown
## Rule: {leader-typed slug — kebab-case, ≤ 40 chars}
**Triggers when** {one-sentence machine-readable-ish condition,
referencing team slugs, entity subtypes from the subscribed teams'
`schema.lock.json`, action_classes from the same, and frontmatter
field thresholds where the leader implied them}.
**Action body should**: {one-sentence directive — what the
scheduled-task pass writes into the action item}.
**Cadence**: {rendered from the chosen option}.
```

Show the synthesised rule back to the leader; `AskUserQuestion`
with options `Save this rule` / `Edit my answers` / `Drop this
rule`. Loop until `Save` — on `Edit`, re-ask whichever of the three
questions the leader names. On `Drop`, discard.

After each save, ask: "Add another alerting rule?" — single
`AskUserQuestion`, `Yes` / `No, move on`. Loop until `No`. **At
least one saved rule is required** before Step 3 — if the leader
tries to advance with zero rules, emit "Leader views need at least
one alerting rule, otherwise the scheduled task has nothing to
synthesise. Want to add one quick rule, or pause onboarding?" —
`Add one rule` / `Pause — I'll come back later`. On Pause, persist
`onboarding_step: 2` to view-config.md and stop cleanly.

### Step 2c — Standing questions (optional)

Ask once: "Want a recurring synthesis — a short summary I generate
on a fixed cadence whether or not your rules fire? Examples:
'Weekly: 200-word velocity summary across all subscribed teams.'"
— `AskUserQuestion`, `Yes, add one` / `Skip`.

On `Yes, add one`, ask two questions:
1. "What should the summary cover, and what cadence? One or two
   sentences."
2. Single `AskUserQuestion` cadence picker — same four options as
   Step 2b (`every-cycle` / `weekly` / `biweekly` / `monthly`).

Synthesise into:

```markdown
## Standing question: {short slug}
{one-line description of what to synthesise}
**Cadence**: {rendered}.
```

Loop with "Add another standing question?" until `Skip`.

## Step 3 — Aggregate vs pointer bias

Single `AskUserQuestion`:

| Option | Stored as |
|---|---|
| Mostly aggregate (combine when possible) | `aggregate_bias: aggregate` |
| Balanced (default) | `aggregate_bias: balanced` |
| Mostly pointers (one item per team) | `aggregate_bias: pointer` |

Frame the question: "When two of your teams hit the same rule, do
you want one combined item or one item per team? Both shapes always
render — this just tunes which the leader-view pass prefers when
both are possible."

On re-entry, default to the existing `aggregate_bias` value.

Persist as `aggregate_bias:` in the view-config frontmatter.

## Step 4 — Cadence picker

The default cadence is **the slowest cadence among the subscribed
teams** — the leader view should not fire before its inputs are
fresh. Resolve by reading each subscribed team's
`<root>/teams/{team-slug}/data/team-config.md.cadence` (the
`60m` / `4h` window from S5.1's onboarding) and translating to a
cron expression on the same beat:

| Slowest team cadence | Default cron |
|---|---|
| 15m–60m | `0 * * * *` (top of every hour) |
| 60m–4h | `0 */4 * * *` (every 4 hours) |
| 4h–12h | `0 8,20 * * *` (8 AM + 8 PM local) |
| 12h–24h | `0 8 * * *` (8 AM local — default) |

Quote the default to the leader:

> "I'll default to {english-form} (the slowest cadence among your
> subscribed teams). Override?"

Single `AskUserQuestion`. The picked option maps to both a cron
expression (Step 5 scheduler) and a duration string (sync due-check):

| Option | Cron | Duration |
|---|---|---|
| Top of every hour | `0 * * * *` | `1h` |
| Every 4 hours | `0 */4 * * *` | `4h` |
| Twice a day (8 AM + 8 PM) | `0 8,20 * * *` | `12h` |
| Once a day (8 AM, default) | `0 8 * * *` | `24h` |
| Once a week (Monday 8 AM) | `0 8 * * 1` | `7d` |

Floor: hourly. Ceiling: weekly. The picker enforces these by only
listing the five options above; never accept a free-form cron
override. No sub-hourly cadences in V1 — LLM cost would grow
unbounded.

Persist **both** keys to view-config frontmatter: `cron:` (used by
Step 5's scheduler) AND `cadence:` (the equivalent duration —
`1h`/`4h`/`12h`/`24h`/`7d` — read by `reference/sync.md`'s
leader-view due-check to compute `due_at = last_run_at + cadence`).
They MUST describe the same beat — the two are independent
enforcement points.

## Step 5 — Register the leader-view scheduled task

Mirror Team-Lead step 7 — use the host scheduler MCP tool:

```
mcp__scheduled-tasks__create_scheduled_task({
  taskId: "agntux-teams-leader-view-{view-slug}",
  description: "AgntUX Teams — leader view for {display_name}",
  prompt: "/agntux-teams sync leader:{view-slug}",
  cronExpression: "{from Step 4}",
  notifyOnCompletion: false
})
```

The dispatch prompt is the `sync leader:` shape — `reference/sync.md`'s
preflight reads `$ARGUMENTS` and routes to the leader-view pass when
it sees the `leader:` prefix.

Capture the response's `taskId` (it should match the
`agntux-teams-leader-view-{view-slug}` shape — Cowork's scheduler
echoes the caller-supplied id). Persist to view-config frontmatter
as `scheduled_task_id:`.

**On re-entry** (the task already exists from a prior onboarding
run), the create call returns the existing task; if the cadence
changed, follow up with
`mcp__scheduled-tasks__update_scheduled_task` to update
`cronExpression` in place. **Do not delete + recreate** — the task's
audit log lives on the id.

**On MCP failure** (the scheduled-tasks server is unreachable):
write the view-config in the Step 6a shape with the leader's
collected Step 1–4 answers, **but** with `onboarding_complete:
false` and `onboarding_step: 5`, **no** `scheduled_task_id:` field,
**no** summary card, and **no** `.onboarded` marker. Then emit
"Couldn't register the scheduled task — Cowork's scheduler isn't
responding. Your answers have been saved; re-run
`/agntux-teams onboard:leader {view-slug}` once Cowork is healthy
to register the task." and stop. The re-entry path picks up at
Step 5 because `onboarding_step` is 5 + `scheduled_task_id` is
missing — both signals; either alone is sufficient.

## Step 6 — Persist + summary + marker

### Step 6a — Write view-config.md

Compose the final file at
`<root>/leader-views/{view-slug}/data/view-config.md`. **One Write
call, atomic from the leader's perspective.** The PreToolUse
`validate-team-write-lane` hook gates writes under
`<root>/leader-views/{slug}/` to `agntux-teams` only — this skill
runs as `agntux-teams` so the write passes.

Shape:

```markdown
---
view_slug: <slug>
view_id: <uuid-from-teams.json>
display_name: <display>
owner_user_slug: <user-slug>
subscribed_teams:
  - <team-slug-1>
  - <team-slug-2>
relevance_filter: <one-line summary from Step 2a>
aggregate_bias: <from Step 3>
cadence: <duration from Step 4 — e.g. "1h", "4h", "12h", "24h", "7d">
cron: <cron expression from Step 4>
scheduled_task_id: <from Step 5>
schema_version: "1.0.0"
onboarding_complete: true
onboarding_step: 6
onboarded_at: <ISO-8601-now>
---

# {display_name}

{free-text — the leader's own articulation of what they're
watching for, taken verbatim from Step 2a's raw answer. The
relevance_filter frontmatter holds the one-line summary; the body
holds the leader's words. The leader-view pass reads both — the
body is context for the LLM when synthesising borderline cases.}

# Alerting rules

Each rule below tells the leader-view scheduled task what kinds of
events warrant an action item for the leader. The rule body is
plain English — the leader-view pass (LLM) reads the rules and the
subscribed teams' data each cycle and writes matching action items.

{Step 2b's synthesised rules, in the canonical
"## Rule: ... / **Triggers when** / **Action body should** /
**Cadence**" shape — one block per rule.}

# Standing questions

{Step 2c's synthesised standing questions, in the canonical
"## Standing question: ... / {description} / **Cadence**" shape.
Omit this heading entirely if zero standing questions were added.}
```

The PostToolUse `maintain-team-index` hook is **not** triggered for
the leader-views path (the hook scopes to `<root>/teams/**`); no
index update is needed here.

### Step 6b — Summary card

Emit a single `mcp__cowork__create_artifact` card titled
`Leader view ready: {display_name}`:

```
Your leader view **{display_name}** is set up.
  · Watching for: {relevance_filter}
  · Subscribed teams: {teams}
  · Alerting rules: {count} rule{s} authored
  · Standing questions: {count, or "none"}
  · Bias: {aggregate_bias}
  · Cadence: {english-form of cron, e.g., "every day at 8 AM"}
  · Scheduled task: {scheduled_task_id}

The first leader-view pass will fire at the next scheduled tick
and synthesise action items into
`<root>/leader-views/{view-slug}/actions/`. To edit any of the
above, re-run `/agntux-teams onboard:leader {view-slug}`.
```

### Step 6c — Drop the completion marker

Write a zero-byte marker at
`<root>/leader-views/{view-slug}/.onboarded`. The marker exists so
that the P4 daemon's leader-views readiness scan (P8) can detect
"this leader has finished onboarding" without parsing the
view-config frontmatter. Idempotent — overwrite on re-entry.

## Edit semantics

Re-running `/agntux-teams onboard:leader {view-slug}` against a
view with `onboarding_complete: true`:

1. The preflight `subscribed_team_count > 0` gate runs again — if
   the Org Admin removed all subscriptions in the web app since
   the last run, the skill exits with the "no teams subscribed
   yet" card (no destructive write).
2. Each step pre-fills its answer from the existing frontmatter
   and body. The leader sees "Current: {value}. Change?" for each
   step.
3. Step 2b walks the existing rules — for each, an
   `AskUserQuestion` with options `Keep as-is` / `Edit this rule` /
   `Delete this rule`. After existing-rule walkthrough, offer
   "Add a new rule?" as in first-run.
4. Step 5 reuses the existing `scheduled_task_id` and only updates
   the task if `cron` changed.
5. "Producing **no changes**" means **all** of: every step's
   `AskUserQuestion` returned the keep-as-is option; no new rules
   or standing questions added; no existing rule edited or deleted;
   `cron`, `cadence`, `aggregate_bias`, `relevance_filter` match
   the on-disk values. Only then → emit "Nothing changed." and
   stop without rewriting view-config.md (preserve `onboarded_at`).
   Any single change → rewrite the full file. `onboarded_at` is
   first-run only — do not bump on edits.
6. **Rule-slug stability.** The sync pass keys actions by
   `triggered_by_rule_hash` (derived from rule slug). Renaming a
   `## Rule:` slug detaches future fires from prior actions (they
   become orphans). When the leader picks `Edit this rule`, present
   the slug as read-only unless they explicitly opt into
   "rename + start fresh" — and warn them once.

Adding or removing subscribed teams is **not** in this skill — that
lives in the web app at
`app.agntux.ai/org/{org-slug}/leader-views/{view-slug}`. The leader
sees the current subscribed-team list as read-only here.

## Out of scope

- **Adding/removing subscribed teams.** Org Admin's job in the web
  app.
- **Editing rules outside this skill.** Re-run the skill — there is
  no `teach:leader` / `reshape:leader` sub-command in V1.
- **Reading raw team entities.** The leader-view pass has read-only
  access to `<root>/teams/{slug}/` mediated by the rule body;
  there's no manual entity browser in this plugin.
- **Generating leader-view action items now.** That's the
  scheduled task's job — the first dispatch fires on the next
  cadence tick.
- **Cross-org leader views.** A leader view's `subscribed_teams[]`
  is always within one org per P6's identity model.
