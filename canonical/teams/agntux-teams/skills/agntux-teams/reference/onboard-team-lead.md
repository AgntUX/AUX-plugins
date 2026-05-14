# `/agntux-teams onboard:team-lead {team-slug}` — Team-Lead onboarding

Lane: walk a freshly-invited team lead through naming their team, defining
its scope, designing the per-team schema, registering the sync cadence, and
recording their own member record. Produces `schema.lock.json` — the gate
that unblocks `onboard:member` for everyone else on the team.

## Voice and authoring rules

- One AgntUX-Teams voice. Never say "step", "Mode A", "subagent",
  "router", "dispatch", "schema_version", "subtype", "action_class", or
  any other internal phrase. Step transitions are silent.
- Open each step with one warm, terse anchor question; phrase follow-ups
  in the team-lead's vocabulary. Save after every step — re-entry reads
  the marker, never in-memory state.
- Pre-suggest defaults whenever context exists. Bound confirmation
  loops: max 2 revisions; Step 3's add/remove caps at 3 rounds.
- Auto-write what the team-lead shouldn't opine on (timestamps, schema
  version, paths, cron). Confirm fields with real intent (purpose,
  relevance picks, cadence).
- Native tools when they help: `AskUserQuestion` for picks,
  `mcp__scheduled-tasks__create_scheduled_task` for the sync,
  `mcp__cowork__create_artifact` for the final summary. Fall back to
  chat when a native tool is unavailable.
- Anti-patterns: do NOT ask the team-lead to "walk through a typical
  day" (scope is bounded), and do NOT `WebSearch`.

## Step 0 — Preflight (no writes)

> **License freshness gate (runs first).** Run the shared `_lib.md` license-JWT freshness gate first — decode `teams.json.license_jwt`, check `exp` and `subscription_status ∈ {trialing, active, lapse_grace}`. Failure exits cleanly to `app.agntux.ai/org/{slug}/billing` (no writes; no state changes). On `lapse_grace`: soft-warn and continue.

1. **Parse `$ARGUMENTS`.** First token is `{team-slug}`. Missing →
   "Usage: `/agntux-teams onboard:team-lead {team-slug}`" and stop.

2. **Verify team-lead role.** Read
   `<root>/.agntux/teams.json.memberships[]`. Find the row matching
   `team_slug: {team-slug}`.
   - No row → "You're not a member of `{team-slug}`. Ask your Org Admin
     to confirm in `app.agntux.ai/org/{org-slug}/teams`." Stop.
   - Row with `team_role != "team-lead"` → "`{team-slug}`'s team-lead
     onboarding can only be run by the team lead. Your row shows
     `{team_role}`." Stop.

3. **Delegate if personal profile is missing.** If `<root>/user.md` is
   absent, route to `/agntux onboard` with team context preloaded (the
   data-source question pre-answers from the org's source-plugin
   opt-ins). Resume here automatically once `user.md` lands.

4. **Detect mode.**
   - `<root>/teams/{team-slug}/data/schema/schema.lock.json` already
     present → **edit mode**. Load each prior answer from the existing
     files; each step below asks "want to change this?" instead of the
     first-run anchor.
   - Otherwise → **first-run mode**.

5. **Resume from the per-team marker.** Read
   `<root>/teams/{team-slug}/data/onboarding.md` if it exists. Pull
   `last_completed_step` from frontmatter and skip any step whose
   number is ≤ that value. **Safeguard:** if
   `last_completed_step >= 4` and `schema.lock.json` is missing
   (a previous run crashed mid-Step-4), re-run Step 4 from scratch —
   the partial schema files are over-writable.

6. **Create the team data root** (idempotent — safe to re-run):
   `<root>/teams/{team-slug}/data/`,
   `<root>/teams/{team-slug}/data/schema/{entities,actions}/`,
   `<root>/teams/{team-slug}/data/members/`, and
   `<root>/teams/{team-slug}/{entities,actions}/`.

   Seed `team-config.md` with the skeleton if absent. The frontmatter
   grows step-by-step; initial shape:

   ```yaml
   ---
   team_slug: {team-slug}
   team_id: {uuid-from-teams.json}
   display_name: ""
   cadence: ""
   schema_version: "1.0.0"
   onboarding_complete: false
   last_completed_step: 0
   authorized_plugins:
     - agntux-teams
   created_at: {now-iso}
   updated_at: {now-iso}
   ---
   ```

## Step 1 — Team identity (anchor)

Resolve `{display_name}` from `<root>/.agntux/teams.json.memberships[]`.
Fall back to `GET /api/teams/{org}/teams/{team-slug}/status` if the
daemon has surfaced the row but not yet stamped the local file.

**Anchor question, verbatim:**

> You're the team lead for **{display_name}**. In one sentence, what
> does this team ship — and what does success look like 90 days from
> now?

Capture the literal answer as `purpose:` in `team-config.md` frontmatter
(one-line summary) and as the body's `# Purpose` section (the user's
exact phrasing). Update `display_name` in frontmatter. Bump
`last_completed_step: 1`; update `updated_at`. Save.

## Step 2 — Team scope (3–4 adaptive follow-ups)

Drawn from Step 1's answer. Pick 3–4 from this set; phrase each in the
team-lead's vocabulary, not jargon:

- "Who's the team mainly accountable to — customers, executives, another team?"
- "What kinds of decisions does this team make that the whole team needs to see?"
- "What kinds of customer or external signal does the team need to not miss?"
- "Anything chronically dropping on the floor that you want this to catch?"

Persist each answer as a bullet under a `# Scope` body section in
`team-config.md`. Stop after at most 4 follow-ups — team onboarding is
bounded. Bump `last_completed_step: 2`; save.

## Step 3 — Pre-suggested relevance classes

Members will pick from this list at member onboarding. The team-lead
doesn't invent classes from scratch — the skill infers 4–6 candidates
from Steps 1+2, presents them via `AskUserQuestion`, and lets the lead
edit/add/remove via a bounded dialogue.

**Inference heuristic — verbatim from the P8 step-3 mapping.** For each
scope signal that appears in the team-lead's answers, union the matching
slugs; cap at 6 total:

| Team scope signal | Suggested classes |
|---|---|
| Customer-facing (sales, CX, support) | `customer-pain`, `customer-escalation`, `product-feedback`, `account-status` |
| Product / engineering | `product-decisions`, `customer-pain`, `infra-incidents`, `velocity-blockers` |
| Ops / infrastructure | `infra-incidents`, `velocity-blockers`, `cost-anomalies`, `compliance-flags` |
| Leadership / cross-functional | `velocity-blockers`, `customer-escalation`, `product-decisions`, `team-health-signals` |
| Catch-all default | `customer-pain`, `product-decisions`, `velocity-blockers`, `general` |

**Fixed one-line description per slug** (so members read the same copy
the team-lead approved):

| Slug | Description |
|---|---|
| `customer-pain` | Raw customer feedback that hints at unmet needs |
| `customer-escalation` | Urgent customer-side issues needing fast response |
| `product-feedback` | Feature requests and product reactions |
| `account-status` | Revenue or churn signals on named accounts |
| `product-decisions` | Decisions logged anywhere the team should see |
| `infra-incidents` | Incidents, outages, on-call signals |
| `velocity-blockers` | Cross-team blockers slowing the team down |
| `cost-anomalies` | Cost or spend spikes worth flagging |
| `compliance-flags` | Compliance, audit, regulatory signals |
| `team-health-signals` | Morale, attrition, capacity signals |
| `general` | Catch-all when nothing else fits |

**Present via `AskUserQuestion`** (multi-select; one option per
suggested slug; the description doubles as the option subtext):

```
question: "I'm planning to track these kinds of decisions and signals for {display_name}. Pick the ones that fit — anything you skip I'll leave out."
header: "Relevance"
multiSelect: true
options: [ { label: "{slug}", description: "{description}" }, … ]
```

**Edit dialogue, max 3 rounds.** After the picks, ask:

> Anything missing? Anything to rename? Say "looks right" when it's
> good.

Each round: "Add `{phrase}`" → slugify (lowercase, hyphens), prompt
for a one-line description, append. "Remove `{slug}`" → drop. "Rename
`{old}` to `{new}`" → swap slug + description, preserve order. "Looks
right" / silence / no-op → exit. On round 4, force-exit with whatever
picks are current. If the team-lead asks for a chip editor (drag-
reorder, >8 chips), you MAY call `mcp__visualize__show_widget` posting
`window.sendPrompt(JSON.stringify({add: [...], remove: [...]}))` back
into chat — but default is chat.

**Output to `team-config.md` frontmatter:**

```yaml
relevance_classes:
  - slug: customer-pain
    description: Raw customer feedback that hints at unmet needs
  - slug: ...
    description: ...
```

Bump `last_completed_step: 3`; save.

## Step 4 — Schema design

Inlines `/agntux schema` Mode-A, parameterised for the team's data
root. The team's schema is **plugin-agnostic** — never references
specific source plugin slugs; the lift pass reads any personal entity
that fits the schema regardless of source.

**4a — Propose subtypes.** Synthesise 3–6 candidates from the team's
purpose + scope. Examples: customer-facing → `customer`, `account`,
`feedback-item`; product/engineering → `project`, `decision`,
`incident`; ops → `incident`, `runbook`, `system`; leadership →
`initiative`, `team`, `decision`. Present:

> Based on what you've told me, here's what I'm planning to keep track
> of for the team:
>
> - **{plain-language category}** — {one-line description}.
>
> Sound right? Anything missing, or anything that doesn't quite fit?

Translate responses silently to formal changes. 6 categories ceiling.

**4b — Confirm action classes.** The `action_classes[]` enum mirrors
the Step-3 `relevance_classes` (same taxonomy — what the team cares
about is what triggers team items). Ask once:

> When something needs the team's attention, those same classes —
> {comma list} — are what'll trigger the items. Anything to add or
> remove for that side specifically?

Most teams say no. Any add/remove updates both lists in lockstep.

**4c — Write the team schema atomically, in order.** The PreToolUse
`validate-team-write-lane` hook accepts `agntux-teams` writing under
`teams/{team-slug}/data/schema/`. The validator self-heals any
hook-computed field via the rejection runbook — never compute hashes;
Re-Edit with the value the runbook quotes.

1. `<root>/teams/{team-slug}/data/schema/entities/_index.md` — approved
   subtypes with a one-line description per subtype.
2. `<root>/teams/{team-slug}/data/schema/entities/{subtype}.md` — one
   file per accepted subtype. Sections: `## Description`,
   `## Required frontmatter`, `## Optional frontmatter`,
   `## Body sections`, `## Aliases`.
3. `<root>/teams/{team-slug}/data/schema/actions/_index.md` — the
   `action_classes[]` enum (= `relevance_classes` slugs) plus the
   P9 team-action required fields inline so day-one readers see what
   every action carries: `team_id`, `team_slug`, `source_team`,
   `schema_version`, `trigger_key` (hook-computed — leave blank),
   `relevance_classes[]`, `reason_class`, `entity_refs[]` (each entry
   has `entity_id` and `role`), `status`
   (`open`|`done`|`dismissed`|`superseded`), `created_at`,
   `authored_by_user_slug`, `last_authored_at`. Closure fields
   (`done_by_user_slug`, `done_by_user_id`, `done_at`) are nullable
   until the action is marked done — not in `required_action_fields[]`
   since the lock tracks "required at author time".
4. `<root>/teams/{team-slug}/data/schema/schema.md` — the
   human-readable master shape; references `entities/_index.md` and
   `actions/_index.md`.
5. `<root>/teams/{team-slug}/data/schema/schema.lock.json` — the
   machine lock at `schema_version: "1.0.0"`:

   ```json
   {
     "schema_version": "1.0.0",
     "generated_at": "{now-iso}",
     "team_slug": "{team-slug}",
     "entity_subtypes": ["{subtype-1}", "..."],
     "action_classes": ["{class-1}", "..."],
     "required_action_fields": [
       "team_id", "team_slug", "source_team", "schema_version",
       "trigger_key", "relevance_classes", "reason_class",
       "entity_refs", "status", "created_at",
       "authored_by_user_slug", "last_authored_at"
     ],
     "checksum": "sha256:UNCOMPUTED"
   }
   ```

   The validator hook fills `checksum` on the next team-write — the
   LLM never hashes.

Confirm in plain language:

> Got it. I'll keep track of: {comma list of subtypes}. When something
> needs the team's attention, I'll classify it by {comma list of
> action classes}.

Bump `last_completed_step: 4`; save.

## Step 5 — Per-plugin instructions (lazy, optional)

Ask one short question:

> Are there nuances about specific tools your team uses? For example,
> "in Slack, focus on customer-facing channels" or "in Gmail, skip
> internal-only threads." Skip if you'd like — you can always add this
> later via `/agntux-teams teach {team-slug}`.

For each plugin the team-lead names, write
`<root>/teams/{team-slug}/data/instructions/{plugin-slug}.md` (same
file shape as `teach.md`):

```yaml
---
team_slug: {team-slug}
plugin_slug: {plugin-slug}
schema_version: "1.0.0"
updated_at: {now-iso}
---
```

Body: `# Always raise` + `# Never raise` + `# Rewrites` + `# Notes`
sections, each with bullets quoting the team-lead's literal phrasing
and a `(source: {YYYY-MM-DD} team-lead onboarding)` provenance line.
No validation of the plugin slug — the lift pass just consults
whichever files exist when it encounters data from that plugin. These
files are **read-only consultation**, not write grants — naming a
plugin here does NOT add it to `authorized_plugins:`; only
`agntux-teams` writes into the team root. On "skip", leave the
`instructions/` directory empty. Bump `last_completed_step: 5`; save.

## Step 6 — Cadence picker

`AskUserQuestion` (single-select):

```
question: "How often should the team's sync run?"
header: "Cadence"
multiSelect: false
options:
  - label: "Every hour (recommended)"
    description: "Hourly during business hours (7am–9pm local). Matches the team-data settling rhythm."
  - label: "Every 30 minutes"
    description: "Faster but more LLM cost. Useful for fast-moving teams."
  - label: "Every 4 hours"
    description: "Lower cost. Useful for slow-moving teams."
```

Map the answer to a cron expression (Cowork evaluates cron in local
time):

| Option | Cron |
|---|---|
| Every hour (recommended) | `0 7-21 * * *` |
| Every 30 minutes | `*/30 7-21 * * *` |
| Every 4 hours | `0 7,11,15,19 * * *` |

Persist `cron:` and `cadence:` (human label) to `team-config.md`.
Bump `last_completed_step: 6`; save.

## Step 7 — Register the team-sync scheduled task

Use `mcp__scheduled-tasks__create_scheduled_task` to register the
per-team sync. Config without a registered task is dead config; the
sync only fires once this is wired.

Resolve via `ToolSearch({query: "select:mcp__scheduled-tasks__create_scheduled_task,mcp__scheduled-tasks__list_scheduled_tasks,mcp__scheduled-tasks__update_scheduled_task", max_results: 5})`,
then call `mcp__scheduled-tasks__list_scheduled_tasks()`. If
`taskId: "agntux-teams-sync-{team-slug}"` exists (edit mode), call
`mcp__scheduled-tasks__update_scheduled_task` with the new
`cronExpression`. Otherwise:

```
mcp__scheduled-tasks__create_scheduled_task({
  taskId: "agntux-teams-sync-{team-slug}",
  description: "AgntUX Teams — sync for {display_name}",
  prompt: "/agntux-teams sync {team-slug}",
  cronExpression: "{cron from Step 6}",
  notifyOnCompletion: false
})
```

Persist the returned `taskId` to `team-config.md` frontmatter as
`scheduled_task_id`.

**Graceful degradation.** If the tool does not resolve (Claude Code
CLI, stripped host), fall back to the cron already written in Step 6
and tell the user: "I can't register the recurring task from inside
this host. Open your host's scheduled-task UI and create a task with
prompt `/agntux-teams sync {team-slug}`, cron `{cron}`, name 'AgntUX
Teams — sync for {display_name}'." Set
`scheduled_task_id: pending-manual-registration` and continue. The
lift pass tolerates the missing task. Bump `last_completed_step: 7`;
save.

## Step 8 — Team-lead's own member record

One short question:

> Last thing on you specifically — anything you want your future self
> to remember about what you're watching for as team lead? (Skip is
> fine.)

Write `<root>/teams/{team-slug}/data/members/{lead-user-slug}.md` with
frontmatter `user_slug`, `user_id` (both from `teams.json`),
`team_slug`, `team_role: team-lead`, `joined_at` (from `teams.json`),
`consent_at: {now-iso}`, `consent_text_version: v1-2026-05-12`, and
`relevance_classes:` set to every Step-3 slug (leads default to all
classes). Body is the answer to the question above, or empty on skip.

Update `<root>/.agntux/teams.json` memberships entry's `consent_at`
and `consent_text_version` locally — the daemon syncs server-side on
its next push. Bump `last_completed_step: 8`; save.

## Step 9 — Schema-ready trigger + summary artifact

**Schema-ready trigger** (automatic — team-lead does nothing). The
team's sync container picks up `schema.lock.json` via the P5 push
pipeline. The push handler detects `kind=team` +
`path=data/schema/schema.lock.json` and: UPDATEs
`teams.schema_ready_at = now()` server-side; sends `team-schema-ready`
emails to every `team_members` row where `consent_at IS NULL AND
left_at IS NULL`; emits `team-schema-ready` role-events to those
members' P4 daemons. Tell the team-lead:

> Your team's data shape is on its way to anyone you've already
> invited — they'll get an email when they can join.

**Summary artifact.** Write static HTML + inline CSS (no external
resources beyond the documented Chart.js / Grid.js / Mermaid allow-list,
which this card doesn't need) to
`{cwd}/.agntux-teams-onboard-summary-{team-slug}.html`. Body:

```
You're set up. Here's what comes next:
  · Team: {display_name} ({team-slug})
  · Cadence: {human label}
  · Relevance classes: {comma list}
  · Subtypes: {comma list}
  · {N} member(s) will get an email — they can now finish joining.

Run /agntux-teams status {team-slug} anytime to see roster + sync
state.
```

Then call:

```
mcp__cowork__create_artifact({
  id: "agntux-teams-onboard-{team-slug}",
  html_path: "{absolute path to the summary file}",
  description: "AgntUX Teams — {display_name} onboarding summary",
  mcp_tools: []
})
```

**Fallback.** If `mcp__cowork__create_artifact` doesn't resolve, print
the same text inline in chat. No crash. Bump `last_completed_step: 9`;
save.

## Step 10 — Drop the marker

Write `<root>/teams/{team-slug}/data/onboarding.md`:

```yaml
---
type: team-lead-onboarding-progress
team_slug: {team-slug}
completed_at: {now-iso}
schema_version: "1.0.0"
relevance_class_count: {N}
entity_subtype_count: {N}
scheduled_task_id: {id or pending-manual-registration}
last_completed_step: 10
---
```

Set `onboarding_complete: true` in `team-config.md` frontmatter (final
write). Bump `last_completed_step: 10`; refresh `updated_at`. Exit.

## Edit mode

If `schema.lock.json` exists at Step 0, every step runs in
"want to change this?" form: load the prior answer; open with "I have
your current `{field}` as **{value}**. Change it?"; on "no" → skip +
bump `last_completed_step` + save; on "yes" → walk as in first-run +
persist.

Schema edits in Step 4 are additive-only per P7. MINOR self-heals via
the hook + runbook loop. MAJOR is forbidden — the team-lead must run
`/agntux-teams reshape {team-slug}` (which itself rejects MAJOR). A
cadence change in Step 6/7 calls
`mcp__scheduled-tasks__update_scheduled_task` against the existing
`scheduled_task_id`, not `create_*`.

## Be honest

- If the team-lead bails mid-flow, save what you have, drop the marker
  with `last_completed_step` where you left off, and exit cleanly.
  Re-running resumes.
- If the Step-3 heuristic has nothing to lock onto (purpose is "I
  dunno"), use the catch-all default and say: "I'm starting with a
  generic baseline — we'll refine after a cycle or two of real data."
- If `AskUserQuestion`, `mcp__scheduled-tasks__create_scheduled_task`,
  or `mcp__cowork__create_artifact` is unavailable, fall back to chat
  + manual instructions. Never crash the flow on a missing host tool.

## Out of scope

- Inviting other team members — web-app territory
  (`app.agntux.ai/org/{org-slug}/teams/{team-slug}/members`).
- Org-wide settings — also web-app.
- Schema reshape after onboarding completes — `/agntux-teams reshape`.
- Per-team rules after onboarding — `/agntux-teams teach`.
- Generating action items — the scheduled task does that on the next
  fire after this flow completes.
