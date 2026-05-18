# AgntUX Teams

Team coordination for AgntUX. Lifts personal data into shared team views,
generates team-relevant action items, and runs the per-team scheduled task
that powers cross-member coordination.

## What it does

`agntux-teams` is the proprietary plugin that turns a single-user AgntUX
install into a team-aware install. It writes the gate file
`<agntux project root>/.agntux/teams.json` that the public
`agntux-core` / `agntux-build` plugins read to activate their team-aware
behaviour. Without `agntux-teams` the public plugins behave exactly as
they do for a solo user.

The plugin is **skill-driven** — there are zero MCP tools. All work runs
in the LLM's own context via the `/agntux-teams` skill body, audited by
deterministic hooks on every Write/Edit.

## Sub-commands

| Command | Purpose |
|---|---|
| `/agntux-teams` (no args) | The per-team scheduled task. De-conflicts conflicted-copy siblings and trigger_key duplicates, lifts personal data to team scope, generates team-relevant action items, advances cursors. Per-team cadence dispatch inside the skill body. |
| `/agntux-teams onboard:team-lead {team-slug}` | Team Lead interview — name the team, define team data sources, design team schema, set scheduled-task cadence. |
| `/agntux-teams onboard:member {team-slug}` | Team Member onboarding — consent to share specific personal-data slices, choose member-relevance categories. |
| `/agntux-teams onboard:leader {view-slug}` | Leader onboarding — choose which teams + individuals feed a leader view; author rule-driven alerts. |
| `/agntux-teams ask {natural language}` | Live read-only query against team data. |
| `/agntux-teams teach {team-slug} {rule}` | Per-team rules ("Always raise X for this team", "Never raise Y"). |
| `/agntux-teams status` | Read-only summary of team membership + recent sync state. |
| `/agntux-teams reshape {team-slug}` | Per-team schema reshape one-shot. |

## Installation

`agntux-teams` is **not installed manually**. The AgntUX web app
(`app.agntux.ai`) provisions a private marketplace repo per Org and
writes a copy of this plugin tree into that repo at
`plugins/agntux-teams/` as a **relative-path source** in the org's
`marketplace.json`. Org Admins enable it in Claude Desktop's
organization plugin settings; team members add it from their plugin
browser.

## Recommended scheduled task

| Task | Prompt body | Cadence |
|---|---|---|
| Team scheduled task (dispatch) | `/agntux-teams` | Every 15 min, 7am–7pm weekdays local |

The 15-min dispatch is the floor. Each team's `team-config.md` carries
its own `cadence:` (default 60 min). The skill body's preflight reads
each team's `cursors.json.last_run_at` and skips teams whose cadence
hasn't elapsed.

## Hooks

Two PreToolUse / PostToolUse hooks ship with this plugin and audit
every Write/Edit under `<root>/teams/` and `<root>/leader-views/`:

- **`validate-team-write-lane`** — rejects writes by a plugin slug not
  authorized in the team's `team-config.md` `authorized_plugins:` list.
- **`maintain-team-index`** — keeps per-team `_index.md` and
  `_sources.json` in sync, AND maintains the `trigger_key_index` map
  introduced by P9 for write-1 + filter-at-render idempotency.

The hooks reuse byte-frozen copies of agntux-core's helper modules
(`agntux-root.mjs`, `frontmatter.mjs`, `schema-lock.mjs`) plus the new
`trigger-key.mjs` helper. The "byte-frozen" invariant means these
copies must match the canonical source verbatim — never hand-edit.

## License

Proprietary. See [LICENSE](./LICENSE). Use of this plugin requires an
active AgntUX Teams subscription, validated at runtime via the
`license_jwt` field in `<agntux project root>/.agntux/teams.json`.
