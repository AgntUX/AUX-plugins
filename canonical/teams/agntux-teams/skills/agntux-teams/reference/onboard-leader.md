# `/agntux-teams onboard:leader {view-slug}` — Leader-view onboarding

> **STUB — S5.3 fills in the interview content.** This file is the
> step-0 preflight skeleton + a TODO marker. The interview body
> (rule-authoring walkthrough, standing-question picker, cadence
> picker) is owned by **P8 / sub-plan S5.3**.

Lane: walk a leader-view owner through subscribing the view to
specific teams, authoring the plain-English alerting rules that
drive synthesised action items, and setting standing questions.

## Step 0 — Preflight

1. **Parse `$ARGUMENTS`.** The first token is `{view-slug}`. Missing
   → emit "Usage: `/agntux-teams onboard:leader {view-slug}`" and
   stop.

2. **Verify the user owns this leader-view.** Read
   `<root>/.agntux/teams.json.leader_views[]`. The row must exist
   with `owner: true` and `view_slug: {view-slug}`. Missing →
   emit "You don't own a leader view called `{view-slug}`. Org Admin
   creates leader views in
   `app.agntux.ai/org/{org-slug}/leader-views`." and stop.

3. **Verify the subscribed teams are onboarded.** Read
   `teams.json.leader_views[<this>].subscribed_teams[]`. For each,
   confirm `<root>/teams/{team-slug}/data/team-config.md` exists
   AND `onboarding_complete: true`. If any are not, emit a short
   message listing which teams' leads still need to finish
   onboarding, then stop. **Do not proceed** — the rule-authoring
   step needs access to each team's schema to know what's
   queryable.

4. **Verify re-entry safety.** Check
   `<root>/leader-views/{view-slug}/data/view-config.md`.
   - **Absent** (first-run) → proceed.
   - **Present + `onboarding_complete: true`** → emit "Leader view
     `{view-slug}` is already onboarded. Re-run this command to edit
     rules; existing rules are the defaults." and **proceed** into a
     re-entry interview.

5. **Create the leader-view data root** if absent:
   - `<root>/leader-views/{view-slug}/data/`
   - `<root>/leader-views/{view-slug}/actions/`
   - `<root>/leader-views/{view-slug}/data/view-config.md` (skeleton
     — frontmatter only, body authored in step 2 below):

   ```yaml
   ---
   view_slug: <slug>
   view_id: <uuid-from-teams.json>
   display_name: ""
   owner_user_slug: <slug>
   subscribed_teams:
     - <team-slug-1>
   cadence: "1h"
   schema_version: "1.0.0"
   onboarding_complete: false
   onboarding_step: 0
   ---
   ```

## TODO — Interview content (owned by S5.3)

The interview body below this line is **not yet authored**. Sub-plan
**S5.3** owns the questions, branching, copy, and the rule-authoring
walkthrough (which feeds the plain-English rules in the leader-view's
`view-config.md` body — see P7's "Leader-view content rules"
section for the file shape).

Sketch of the steps S5.3 must fill in:

1. **Step 1 — Confirm view identity.** Quote `display_name` from
   `teams.json`; confirm or override.
2. **Step 2 — Author the alerting rules** (plain-English markdown
   sections in the view-config body — see P7 § "Leader-view content
   rules" for the exact shape). Each rule has a name, a "**Triggers
   when**" sentence, an "**Action body should**" sentence, and a
   "**Cadence**" sentence. Drive the rule-authoring with one or two
   short questions; never let the leader write raw markdown
   themselves — synthesize from their natural-language description
   and confirm.
3. **Step 3 — Author standing questions** (e.g., "Weekly: synthesize
   a 200-word engineering velocity summary"). Optional — skip if the
   leader has none.
4. **Step 4 — Pick cadence.** Default 1h; range 15m floor to 24h
   ceiling.
5. **Step 5 — Write `view-config.md`** with frontmatter + rules
   body. Mark `onboarding_complete: true`.
6. **Step 6 — Confirm.** One-paragraph summary; remind the leader
   the next dispatch will start producing leader-view action items.

## Out of scope

- **Adding/removing subscribed teams.** Org Admin manages
  subscriptions in the web app
  (`app.agntux.ai/org/{org-slug}/leader-views/{view-slug}`).
- **Rule changes outside this onboarding.** Once onboarded, re-run
  this command to edit rules.
- **Reading raw team entities.** The leader-view skill body's
  read-only access is mediated through the rule body; there's no
  manual entity browser in this plugin.
