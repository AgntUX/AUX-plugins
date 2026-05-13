# `/agntux-teams onboard:member {team-slug}` — Team-Member onboarding

> **STUB — S5.2 fills in the interview content.** This file is the
> step-0 preflight skeleton + a TODO marker. The interview body
> (consent-text wording, relevance-class picker copy, sharing-slice
> explainer) is owned by **P8 / sub-plan S5.2**.

Lane: walk a team member through consenting to share specific
personal-data slices with their team, and picking the
member-relevance categories that filter their team-section view.

## Step 0 — Preflight

1. **Parse `$ARGUMENTS`.** The first token is `{team-slug}`. Missing
   → emit "Usage: `/agntux-teams onboard:member {team-slug}`" and
   stop.

2. **Verify the user is on this team.** Read
   `<root>/.agntux/teams.json.memberships[]`. The row must exist
   (the web-app team-member-add flow writes the row when an admin
   adds the user). Missing row → emit "You haven't been added to
   `{team-slug}` yet. Ask your team lead to add you in
   `app.agntux.ai/org/{org-slug}/teams/{team-slug}/members`." and
   stop.

3. **Verify the team has been onboarded by its lead.** Read
   `<root>/teams/{team-slug}/data/team-config.md`. Missing OR
   `onboarding_complete: false` → emit "`{team-slug}`'s team lead
   hasn't finished onboarding yet. They need to run
   `/agntux-teams onboard:team-lead {team-slug}` first. Check back
   then." and stop.

4. **Verify re-entry safety.** Check
   `<root>/teams/{team-slug}/data/members/{user-slug}.md`. Where
   `<user-slug>` comes from `teams.json.user_slug`.
   - **Absent** (first-run) → proceed.
   - **Present + `consent_at` set** → emit "You've already onboarded
     to `{team-slug}`. To adjust your relevance picks, re-run this
     command — your existing answers will be the defaults." and
     **proceed** into a re-entry interview.

5. **Read the team's schema** to know which `action_classes[]` are
   available for the relevance-class picker. The lock at
   `<root>/teams/{team-slug}/data/schema/schema.lock.json` is the
   source of truth.

## TODO — Interview content (owned by S5.2)

The interview body below this line is **not yet authored**. Sub-plan
**S5.2** owns the questions, branching, copy, and the consent-text
exact wording (which feeds the `consent_text_version` written to
`teams.json` per P6).

Sketch of the steps S5.2 must fill in:

1. **Step 1 — Consent-to-share interview.** Walk each source plugin
   in the team's `authorized_plugins:` list; per-plugin, ask which
   personal-data slices the user is willing to share with this team
   ("share entities from this Slack channel only", "share Gmail
   threads with these external recipients", …). Capture the
   `consent_text_version` (e.g., `v1-2026-05-12`) so legal can audit.
2. **Step 2 — Relevance-class picker.** From the team's
   `action_classes[]` (read in preflight step 5), let the user toggle
   which classes they want to see in their team-section triage. This
   feeds the strict-intersection filter the agntux-core triage UI
   applies at render time.
3. **Step 3 — Write
   `<root>/teams/{team-slug}/data/members/{user-slug}.md`.** Required
   frontmatter (P6-owned):
   ```yaml
   ---
   user_slug: <slug>
   user_id: <uuid>
   team_slug: <slug>
   team_role: member
   joined_at: <from teams.json>
   consent_at: <ISO-8601-now>
   consent_text_version: <e.g., v1-2026-05-12>
   relevance_classes:
     - <class-1>
     - <class-2>
   sharing_slices:
     <plugin-slug>:
       - <slice-spec>
   ---
   ```
4. **Step 4 — Update teams.json**. Set
   `memberships[<this-team>].consent_at` and `consent_text_version`
   to match. (`agntux-teams` writes `teams.json` per the write-lane
   exception in P7.)
5. **Step 5 — Confirm.** Emit a one-paragraph summary of what was
   captured; remind the user the team's next scheduled-task cycle
   will pick up their consent and start filtering.

## Out of scope

- **Schema reshape** — only the team lead can. Route to
  `/agntux-teams reshape {team-slug}`.
- **Per-team rules** — route to `/agntux-teams teach`.
- **Inviting yourself to other teams** — web-app territory.
- **Leaving the team** — voluntary leave is the P4 daemon's job
  (web-app drives the trigger).
