---
name: agntux-teams
description: AgntUX team coordination. One entry point for the per-team scheduled task (default) and team onboarding flows. Sub-commands route to specialised reference bodies. Use for "/agntux-teams", "team scheduled task", "onboard team lead {team-slug}", "onboard member {team-slug}", "onboard leader {view-slug}", "team status", "ask team {…}", "teach team {team-slug} {rule}", "reshape team schema {team-slug}", or any AgntUX-Teams-related request. NOT for solo agntux/triage requests — those route to /agntux.
argument-hint: "[onboard:team-lead|onboard:member|onboard:leader|ask|teach|status|reshape] [args…]"
---

# `/agntux-teams` — AgntUX Teams command center

Lane: single user-facing entry into the proprietary `agntux-teams` plugin.
Route to the right sub-task by reading the first token of `$ARGUMENTS`; if
empty (the typical scheduled-task fire), default to the inline `sync` body
loaded from `reference/sync.md`.

## Voice rules

Speak as a single AgntUX-Teams voice. Never reference internal architecture:
do NOT say "subagent", "dispatch", "Mode A / B / C", "orchestrator",
"router", "skill body", or "sub-command" to the user. Sub-task transitions
are silent — load the matching `reference/{name}.md` resource and follow
its body.

## Preflight (always)

Before any sub-task body, run these gates in order:

1. **Project root.** Resolve `<agntux project root>` per the agntux-core
   ladder: `basename(cwd).toLowerCase() === "agntux"` → use cwd; else
   nearest ancestor with that basename; else `~/agntux/` if it exists.
   None of the above + scheduled-task fire → exit cleanly with no
   message. None of the above + interactive → emit one short
   "I don't see an AgntUX project — run `/agntux onboard` first." and
   stop.

2. **Orchestrator gate.** Check `<agntux project root>/user.md` exists
   and parses. Missing → "This plugin needs AgntUX Core to be installed
   and configured first. Install agntux-core, run `/agntux onboard`,
   then come back." Stop.

3. **Teams gate.** Read `<agntux project root>/.agntux/teams.json`. If
   absent or empty (no `memberships[]` and no `leader_views[]`):
   - Scheduled-task fire (no user) → exit cleanly with no message.
   - Interactive invocation → emit one short
     "You're not on any AgntUX team yet. Run `/agntux-teams onboard:member {team-slug}` once you've been added by a team lead." and stop.

4. **License JWT (preflight only — no body work without it).** Read
   `teams.json.license_jwt`. The skill body checks **structural shape
   only** (the JWT must have three dot-separated base64url segments
   matching the regex `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`).
   - Absent / empty / fails the regex → emit
     "Your AgntUX Teams subscription needs to be set up. Visit
     `app.agntux.ai/billing` to start." and stop.
   - Structurally valid → proceed.

   **V1 cryptographic verification lives in P11**, not in this skill
   body — the AgntUX Teams desktop app refreshes the signed JWT on
   auth-refresh and the renderer-side P4 daemon is responsible for
   spec-compliant signature checks. The public plugins gate only on
   the file's structural presence per the cross-plugin contract.

## Routing table

| `$ARGUMENTS` first token | Resource loaded | Notes |
|---|---|---|
| (empty / `sync`) | [`reference/sync.md`](reference/sync.md) | The per-team scheduled task. Default for bare `/agntux-teams` (the host scheduler fires this). |
| `onboard:team-lead` (+ `{team-slug}`) | [`reference/onboard-team-lead.md`](reference/onboard-team-lead.md) | Team-Lead onboarding — purpose, scope, relevance classes, schema design, per-plugin instructions, cadence, scheduled-task registration. |
| `onboard:member` (+ `{team-slug}`) | [`reference/onboard-member.md`](reference/onboard-member.md) | Team-Member onboarding. **STUB** — S5.2 fills in. |
| `onboard:leader` (+ `{view-slug}`) | [`reference/onboard-leader.md`](reference/onboard-leader.md) | Leader onboarding — relevance filter, alerting rules, cadence, scheduled-task registration. |
| `ask` (+ natural-language) | [`reference/ask.md`](reference/ask.md) | Read-only query against team data. |
| `teach` (+ `{team-slug} {rule}`) | [`reference/teach.md`](reference/teach.md) | Per-team rules writer. |
| `status` | [`reference/status.md`](reference/status.md) | Read-only roster + sync state summary. |
| `reshape` (+ `{team-slug}`) | [`reference/reshape.md`](reference/reshape.md) | Per-team schema reshape one-shot. |

## Argument parsing

1. Trim `$ARGUMENTS`; treat the empty string as the `sync` default.
2. Lowercase the first token. If it matches a sub-command above, load
   `reference/{token}.md` and follow it. The remainder of `$ARGUMENTS`
   is the resource's input (e.g. `onboard:member platform` loads
   `reference/onboard-member.md` with sub-arg `platform`).
3. **No match** → infer intent from the natural-language prompt; default
   to `ask.md` for queries, `status.md` for "how are my teams doing"
   shapes, otherwise emit one short "I don't recognise that — try
   `/agntux-teams status` to see what's available." and stop.

## Out of scope

- Solo / personal triage — those go through `/agntux` (public
  agntux-core plugin).
- Org-admin work (inviting teammates, billing, marketplace audit) —
  those live in the AgntUX web app at `app.agntux.ai`. There is no
  `onboard:org-admin` sub-command in this plugin.
- Building Agent Skills — that's `/agntux-build`.
- Plugin escalations / un-mergeable conflicts — per the no-escalation
  policy, the de-conflict pass leaves siblings in place and re-attempts
  on later cycles. Never call back into the web app from the skill body.
