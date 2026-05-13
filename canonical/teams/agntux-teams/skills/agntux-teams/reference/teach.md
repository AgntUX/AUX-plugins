# `/agntux-teams teach {team-slug} {rule}` — per-team rules writer

Lane: capture a per-team rule the team-lead (or any team member with
team-lead role) wants the scheduled task to honour.

## Preflight

Beyond the SKILL.md preflight:

> **License freshness gate (runs first).** Run the shared `_lib.md` license-JWT freshness gate first — decode `teams.json.license_jwt`, check `exp` and `subscription_status ∈ {trialing, active, lapse_grace}`. Failure exits cleanly to `app.agntux.ai/org/{slug}/billing` (no writes; no state changes). On `lapse_grace`: soft-warn and continue.

1. **Parse `$ARGUMENTS`.** The first token after `teach` is the
   `team-slug`. The remainder is the rule body (free-form
   natural-language).
2. **Verify the user is on this team.** Read
   `<root>/.agntux/teams.json.memberships[]` and confirm a row with
   `team_slug: <team-slug>`. If absent, emit
   "You're not a member of `{team-slug}` — ask the team lead to add
   you, or check the spelling." and stop.
3. **Verify the team exists on disk.** Check
   `<root>/teams/{team-slug}/data/team-config.md` exists. If absent,
   emit "Team `{team-slug}` hasn't been onboarded yet — run
   `/agntux-teams onboard:team-lead {team-slug}` first." and stop.

## How to write the rule

The rule lands in **one of two files**, deterministically:

- **Team-level rule** (applies to every plugin's lift pass):
  `<root>/teams/{team-slug}/data/instructions/_team.md`.
- **Per-plugin rule** (applies only to one source plugin's lift pass —
  e.g., "always raise Slack DMs from Bob to this team"):
  `<root>/teams/{team-slug}/data/instructions/{plugin-slug}.md`.

**Decide which** by reading the rule:

- If the rule names a specific plugin/source ("never raise Slack
  threads from #random", "always raise Gmail from Acme"), write it to
  the per-plugin file. Resolve `{plugin-slug}` from the source name
  via the canonical mapping (`slack` → `agntux-slack`, `gmail` →
  `agntux-gmail`, etc.).
- Otherwise, write to `_team.md`.

## File shape

Both files use the same section structure (mirrors `agntux-core`'s
`<root>/data/instructions/{plugin-slug}.md`):

```markdown
---
team_slug: <slug>
schema_version: "1.0.0"
updated_at: <ISO-8601>
---

# Always raise

- {rule sentence}
- {rule sentence}

# Never raise

- {rule sentence}

# Rewrites

- {rule sentence — "when X comes in, phrase the action as Y"}

# Notes

- {free-form team norm — "we keep action descriptions terse"}
```

For per-plugin files, add `plugin_slug: <slug>` to the frontmatter
beneath `team_slug:`.

## Authoring rules

1. **Read the existing file** (or template a new one if absent).
2. **Pick the right section** by re-reading the user's rule:
   - "Always raise X" / "We always want X" → `# Always raise`.
   - "Never raise X" / "Don't surface X" → `# Never raise`.
   - "When X happens, phrase it as Y" / "Reword X to Y" → `# Rewrites`.
   - Anything else (norms, conventions, terminology) → `# Notes`.
3. **Append the rule** as a single bullet. Do not paraphrase the user's
   intent into the rule wording — quote them as closely as possible
   while keeping it parseable as natural language.
4. **Update `updated_at`** in frontmatter.
5. **Write atomically.**

## Confirmation

After writing, emit one short line:

> "Captured for `{team-slug}` ({_team.md | {plugin-slug}.md}, `# {section}`). The team's next scheduled-task cycle will honour it."

Quote the new bullet verbatim so the user can verify.

## Out of scope

- Rules that affect organization-wide behaviour — those are web-app
  territory (`app.agntux.ai/org/{slug}/settings`), not on-disk.
- Rules that change the team **schema** (new entity subtypes, new
  reason classes) — route to `/agntux-teams reshape {team-slug}`.
- Rules for solo / personal triage — route to `/agntux teach {plugin-slug}`
  (public agntux-core).
