# `/agntux-teams ask` — natural-language query (read-only)

Lane: read-only natural-language query against team data.

## Preflight

The SKILL.md preflight has already verified `<agntux project root>`,
`user.md`, non-empty `teams.json`, and the license JWT's structural
presence. Proceed directly to the query.

## What you read

You have **read** access (no Write/Edit) across:

- `<root>/.agntux/teams.json` — the user's team memberships and
  leader-view ownerships.
- `<root>/teams/{team-slug}/data/team-config.md` — team display name,
  cadence, source-plugin opt-ins.
- `<root>/teams/{team-slug}/data/schema/{schema.md,schema.lock.json}` —
  team's data shape.
- `<root>/teams/{team-slug}/data/instructions/{_team.md,*.md}` —
  per-team rules.
- `<root>/teams/{team-slug}/data/members/{user-slug}.md` — each
  member's relevance prefs + consent.
- `<root>/teams/{team-slug}/data/cursors.json` — sync state.
- `<root>/teams/{team-slug}/data/audit.log` — recent cycle summaries.
- `<root>/teams/{team-slug}/entities/_index.md` + each subtype's
  `_index.md` — team entity inventory.
- `<root>/teams/{team-slug}/entities/{subtype}/{slug}.md` — full team
  entity bodies.
- `<root>/teams/{team-slug}/actions/_index.md` — team action inventory
  + the `trigger_key_index` map.
- `<root>/teams/{team-slug}/actions/{date}-{slug}.md` — full team
  action bodies.
- Same shape under `<root>/leader-views/{view-slug}/`.

## How to answer

1. **Resolve the scope.** If the user names a team / leader-view, scope
   to that. If they say "across my teams", walk every entry in
   `teams.json.memberships[]` and `leader_views[]`.

2. **Use indexes first.** `_index.md` files give you a cheap roster
   without reading every detail file. Read full files only when the
   question demands body content (the `## Why this matters`, the entity
   `## Recent signals`, etc.).

3. **Cite paths in answers.** When referencing an entity or action, use
   the bare-slug wiki-link form (`[[acme-corp]]`) plus the file path on
   first mention so the user can navigate. Example:

   > Two open items reference Acme Corp:
   >   - `teams/sales/actions/2026-05-12-acme-renewal-risk.md` —
   >     "Acme Corp signaled churn risk" ([[acme-corp]])
   >   - `teams/sales/actions/2026-05-09-acme-q3-proposal.md` —
   >     "Send Q3 proposal draft to Bob"

4. **Personalization is at-render**, not at-store. When asked "what
   should I look at on Platform?", filter by the strict-intersection
   rule: an item is relevant to a member iff
   `member.relevance_classes ∩ item.relevance_classes ≠ ∅`. Member
   classes live in
   `<root>/teams/{slug}/data/members/{user-slug}.md`.
   Item classes live in the action's `relevance_classes:` frontmatter.

5. **Snooze / dismiss state is personal.** Read
   `<root>/.agntux/triage-prefs.json.triage_state[<path>]` to filter
   out items the user has snoozed or dismissed before reporting them.

## Voice

Match `agntux-core`'s `/agntux ask` voice — concise, deferential,
quote-then-narrate. Never invent data. If the answer requires reading
a file you don't have, say so and stop.

## Out of scope

- **No writes.** Even one-line patches to action status. If the user
  wants to mutate, route them to `/agntux` (the public agntux-core
  triage UI owns mutation, not this skill).
- **No team configuration changes.** Reshape requests go through
  `/agntux-teams reshape {team-slug}`; rules through
  `/agntux-teams teach {team-slug} {rule}`.
- **No cross-tenant queries.** You only see this user's `<agntux project root>/`.
