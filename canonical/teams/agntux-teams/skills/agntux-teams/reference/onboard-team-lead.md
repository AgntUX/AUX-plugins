# `/agntux-teams onboard:team-lead {team-slug}` — Team-Lead onboarding

> **STUB — S5.1 fills in the interview content.** This file is the
> step-0 preflight skeleton + a TODO marker. The interview body
> (questions, branches, schema-design walkthrough, cadence-picker
> copy) is owned by **P8 / sub-plan S5.1**.

Lane: walk a freshly-invited Team Lead through naming their team,
defining the team's data sources, designing the per-team schema, and
setting the scheduled-task cadence.

## Step 0 — Preflight

1. **Parse `$ARGUMENTS`.** The first token is `{team-slug}` (the
   slug the web-app create-team modal generated; immutable per P3).
   If the token is missing, emit "Usage: `/agntux-teams onboard:team-lead {team-slug}`" and stop.

2. **Verify the user is the team-lead of record.** Read
   `<root>/.agntux/teams.json.memberships[]`. Find the row matching
   `team_slug: <team-slug>`. Two failure modes:
   - **No row** → emit "You're not a member of `{team-slug}`. Ask
     your Org Admin to confirm in the web app
     (`app.agntux.ai/org/{org-slug}/teams`)." and stop.
   - **Row exists but `team_role != "team-lead"`** → emit
     "`{team-slug}`'s team-lead onboarding can only be run by the
     team lead. Your row shows `{team_role}`." and stop.

3. **Verify re-entry safety.** Check if
   `<root>/teams/{team-slug}/data/team-config.md` already exists.
   - **Absent** (first-run) → proceed to the interview.
   - **Present** (re-entry) → read the file. If `onboarding_complete:
     true` in frontmatter, emit "`{team-slug}` is already onboarded.
     Run `/agntux-teams reshape {team-slug}` to evolve the schema or
     `/agntux-teams teach {team-slug} {rule}` to add rules." and
     stop. If `onboarding_complete: false`, **resume** from the last
     completed step (read frontmatter for the resume marker).

4. **Create the team data root** if absent:
   - `<root>/teams/{team-slug}/data/` (directory)
   - `<root>/teams/{team-slug}/data/team-config.md` (skeleton — see
     below)
   - `<root>/teams/{team-slug}/data/schema/` (directory)
   - `<root>/teams/{team-slug}/data/members/` (directory)
   - `<root>/teams/{team-slug}/entities/` (directory, empty)
   - `<root>/teams/{team-slug}/actions/` (directory, empty)

   The team-config skeleton frontmatter:

   ```yaml
   ---
   team_slug: <slug>
   team_id: <uuid-from-teams.json>
   display_name: ""
   cadence: "60m"
   schema_version: "1.0.0"
   onboarding_complete: false
   onboarding_step: 0
   authorized_plugins:
     - agntux-teams
   created_at: <ISO-8601>
   ---
   ```

## TODO — Interview content (owned by S5.1)

The interview body below this line is **not yet authored**. Sub-plan
**S5.1** owns the questions, branching, copy, and the schema-design
walkthrough.

Sketch of the steps S5.1 must fill in:

1. **Step 1 — Confirm team identity.** Quote `display_name` from the
   web-app row (read via `teams.json`); confirm or override.
2. **Step 2 — Choose source plugins.** Walk every installed
   `agntux-*` source plugin (Slack, Gmail, etc.) and capture
   per-plugin opt-in. Write to `authorized_plugins:` in
   `team-config.md`.
3. **Step 3 — Design the team schema.** Ask which entity subtypes the
   team needs (people, companies, projects, …); ask which reason
   classes (`customer-pain`, `product-decisions`, …) drive team
   action items. Write `<root>/teams/{team-slug}/data/schema/schema.md`
   (human-readable) and `schema.lock.json` (machine lock); the lock's
   `entity_subtypes[]` and `action_classes[]` are populated here.
4. **Step 4 — Set scheduled-task cadence.** Default 60m; let the lead
   override (range: 15m floor — matches the dispatch — to 4h ceiling).
   Persist to `team-config.md.cadence`.
5. **Step 5 — Save authorized-plugin allow-list.** Write the final
   `authorized_plugins:` list to `team-config.md` (the
   `validate-team-write-lane` hook reads this).
6. **Step 6 — Mark complete.** Set
   `onboarding_complete: true` and `onboarding_step: 6` in
   `team-config.md`. Emit a one-paragraph confirmation summarising
   what was set up.

## Out of scope

- Inviting other team members — that's web-app territory
  (`app.agntux.ai/org/{org-slug}/teams/{team-slug}/members`).
- Org-wide settings — also web-app.
- Authoring per-team rules — those go to `/agntux-teams teach`.
- Generating action items — the scheduled task does that on the next
  fire after onboarding completes.
