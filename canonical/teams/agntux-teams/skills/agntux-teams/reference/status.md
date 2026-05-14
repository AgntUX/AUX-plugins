# `/agntux-teams status` — read-only roster + sync summary

Lane: read-only summary of the user's team membership and recent sync
state.

## Preflight

The SKILL.md preflight has already verified `<agntux project root>`,
`user.md`, non-empty `teams.json`, and the license JWT.

> **License freshness gate (runs first).** Run the shared `_lib.md` license-JWT freshness gate first — decode `teams.json.license_jwt`, check `exp` and `subscription_status ∈ {trialing, active, lapse_grace}`. Failure exits cleanly to `app.agntux.ai/org/{slug}/billing` (no writes; no state changes). On `lapse_grace`: prefix the status report with the soft-warning, then emit the roster.

## What you read

- `<root>/.agntux/teams.json` — `memberships[]` and `leader_views[]`.
- For each team: `<root>/teams/{team-slug}/data/team-config.md` (display
  name, cadence), `cursors.json` (last_run_at), `audit.log` (last 5
  cycle summaries — tail).
- For each leader-view: same trio under
  `<root>/leader-views/{view-slug}/data/`.

## What you emit

A concise markdown report. Format:

```markdown
## Your AgntUX Teams

### Memberships ({N})

- **{Team display name}** (`{team-slug}`) — role: {team-lead | member}
  - Cadence: {Nm | Nh}
  - Last cycle: {N min ago | "no cycle yet"}
  - Recent: deconflicted={N}, lifted={N}, authored={N} (last 5 cycles)

(Repeat per team.)

### Leader views ({N})

- **{View display name}** (`{view-slug}`)
  - Subscribed teams: `{team-slug-1}`, `{team-slug-2}`, ...
  - Cadence: {Nh}
  - Last cycle: {N hr ago | "no cycle yet"}

(Repeat per view. Omit the section entirely if no leader views.)
```

## Compute "last cycle" in human time

- Parse `cursors.json.last_run_at` as ISO-8601.
- Diff against `now` and emit "{N} min ago" / "{N} hr ago" / "{N}
  days ago" with a single integer.
- "no cycle yet" if absent or epoch.

## Compute "Recent" counters

Tail the team's `audit.log` to its last 5 lines. Each line has the
shape:

```
{ISO-8601 run-start} cycle: deconflicted={N} lifted={N} authored={N} re-authored={N} cap-hit={true|false}
```

Sum the `deconflicted=`, `lifted=`, `authored=` integers across the
last 5 lines. If fewer than 5 lines exist, sum what's there.

## Quiet failure

If a team's `cursors.json` or `audit.log` is missing (e.g., team
was just onboarded and the scheduled task hasn't fired yet), emit
"no cycle yet" for that team. Don't error out the entire status
report on one missing file.

If `teams.json` shows zero memberships AND zero leader-views, emit
"You're not on any AgntUX team yet. Ask a team lead to add you, then
run `/agntux-teams onboard:member {team-slug}` once they have." and
stop.

## Out of scope

- **No writes.** Status is pure read.
- **No org-level info.** Org admin views (members, billing,
  marketplace audit) live in the web app at
  `app.agntux.ai/org/{org-slug}/`.
- **No live triage rendering.** That's `/agntux` (the public
  agntux-core triage UI).
