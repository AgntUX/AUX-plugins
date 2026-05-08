---
name: agntux-feedback-review
description: Daily pattern-detection pass over recently done and dismissed action items. Appends observations to `user.md → # Auto-learned` and tags graduation candidates for the personalization subagent. Background flow — fired by a scheduled task whose prompt body is `/agntux-feedback-review`. Users can also invoke directly to audit dismissals on demand.
disable-model-invocation: true
---

# `/agntux-feedback-review` — daily pattern detection

Lane: read-only pattern detection over the user's done + dismissed
action items in the last 30 days. Background flow — Claude must NOT
auto-invoke this skill from natural language. The user (or a
scheduled task) explicitly fires it.

## Schema-drift preflight

Run [`_preflight.md`](../_preflight.md). For scheduled-task fires
where no user is present, skip the preflight per `_preflight.md`'s
background-mode carve-out.

## Preconditions

Run [`_preconditions.md`](../_preconditions.md). Check 0 walks
[`_resolve-root.md`](../_resolve-root.md) — declared here so the link
is one level deep from this SKILL.md (the unattended variant is
inlined under "Always check first" below). For scheduled-task fires
where the user is not present, exit cleanly with no message if any
precondition diverts — don't write spurious status; the next
user-initiated session will surface and fix.

## Always check first

Before reading anything else, do these two checks in order:

1. **Project root**: resolve the AgntUX project root via this ladder;
   stop at the first match. <!-- canonical-mirror: agntux-core/skills/_resolve-root.md (unattended variant) -->
   1. `basename(cwd).toLowerCase() === "agntux"` → use cwd silently.
   2. Any ancestor of cwd has `basename().toLowerCase() === "agntux"` → use the nearest silently.
   3. `~/agntux/` exists and is a directory → use it silently.
   4. None of the above → log one line to stderr, then exit cleanly.
      Do NOT ask interactively — no user is present on a scheduled fire.

   No status banners. This skill runs unattended; there is no user audience for status lines.

2. **`user.md` exists and is parseable**: confirm
   `<agntux project root>/user.md` exists. If it doesn't, exit
   cleanly with no message — the personalization skill will set it up
   on the user's next session. If the frontmatter or expected sections
   are malformed, also exit cleanly — don't append to a malformed
   file.

## Read first

1. `<agntux project root>/user.md` — current preferences and existing
   `# Auto-learned` lines (so you don't duplicate observations).
   Also read `feedback_min_pattern_threshold` from frontmatter
   (default `5` if absent; valid range `3–20`).
2. `<agntux project root>/actions/_index.md` — the catalogue. You'll
   be reading the done + dismissed entries.

## Scope: 30-day pattern window

Operate on action-item files where:

- `status` is `done` OR `dismissed`.
- `completed_at` (if done) or `dismissed_at` (if dismissed) is within
  the last **30 days**.

Filter the index lines first; only read full files when a pattern is
forming. Lines with `@status:done` or `@status:dismissed` in
`actions/_index.md` are your entry points — pick candidate file IDs,
then read full files only for those that clear the initial filter.

## Pattern dimensions

Look for repeating signals across five dimensions:

1. **By `reason_class`** — e.g. "5 of last 8 dismissals on
   `reason_class: knowledge-update` from acme-marketing carry
   `## Outcome: noise` — this kind is genuinely low-value."
2. **By `source`** — e.g. "12 of 14 done items came from Slack."
3. **By `related_entities`** — e.g. "7 done items touched
   `topics/q2-renewal-acme`."
4. **By time-of-day** (read `created_at`) — e.g. "8 noise-marked
   dismissals on items raised after 18:00."
5. **By specific entity** (people / companies) — e.g. "All 4 actions
   involving `companies/acme-marketing` were dismissed with
   `## Outcome: noise`."

A pattern requires at least **N** supporting items in the 30-day
window, where N is `feedback_min_pattern_threshold` (default `5`).
Below N, leave it alone.

## How to read dismissals

Dismissals are ambiguous. A user who dismisses often means "I handled
this in Slack already" — a *positive* signal, not a *negative* one.

- **Dismissal with `## Outcome` indicating completion-elsewhere**
  (`completed-externally`, "already handled in Slack", etc.) →
  **positive** signal → `→ trust this signal more`.
- **`done` with `## Auto-resolved` body section** (user replied in
  Slack; action self-closed) → **positive** signal.
- **Dismissal with `## Outcome: noise`** (or `outcome: irrelevant`)
  → counts toward `→ deprioritize`.
- **Dismissal paired with a new `# Never raise` capture in
  `data/instructions/{plugin}.md`** within ±24h → counts toward
  `→ deprioritize`.
- **Bare dismissal — no `## Outcome`, no `# Never raise` capture** →
  **ambiguous**. Does NOT contribute to any pattern.

When counting dismissals, bucket each as `completion-elsewhere`,
`noise-marker`, `never-raise-paired`, or `bare`. Only the first three
buckets count toward graduation candidates.

## Append to `# Auto-learned`

For each pattern that meets the threshold AND is not already
represented in `# Auto-learned`:

1. Compose a one-line bullet: `<observation> → <recommended adjustment>`.
   Examples:
   - `- 5 dismissals (with "## Outcome: noise") on reason_class: knowledge-update from acme-marketing → deprioritize`
   - `- 12 of 14 done items from Slack (incl. 4 auto-resolved after user reply) → trust Slack-originated items more`
   - `- 8 dismissals carrying "## Outcome: noise" on items created after 18:00 local time → suppress non-critical items in the evening`

2. **Append** at the end of `# Auto-learned`. Never insert mid-list,
   never rewrite or delete prior lines — accumulated history is signal.
3. Update `user.md` frontmatter `updated_at` (date-only,
   e.g. `2026-04-28`).

## Graduation candidates

Some patterns are strong enough to graduate from `# Auto-learned` to
`# Preferences`:

- A `→ deprioritize` bullet present in `# Auto-learned` for **7+
  consecutive daily runs** → candidate for `## Usually noise`.
- A `→ raise as high priority` bullet with the same 7-day repetition
  → candidate for `## Always action-worthy`.

When you spot one, **append `[graduation-candidate]` at the end of
the existing bullet** (or the new bullet you are writing this run):

```
- 5 dismissals (with "## Outcome: noise") on reason_class: knowledge-update from acme-marketing → deprioritize  [graduation-candidate: ## Usually noise]
```

The `/agntux-profile` skill reads these tags and surfaces the proposal
to the user. **You do NOT propose, ask, or edit `# Preferences`** —
your role ends at tagging.

To detect 7 consecutive days: count calendar dates visible in the
`updated_at` progression of matching `# Auto-learned` bullets. If a
matching bullet was appended on 7 different calendar dates, tag it.
If a `[graduation-candidate]` tag is already present, leave it alone.

## New-entity-type signal

If a graduation candidate points at a recurring entity type that
**doesn't exist** in `data/schema/entities/_index.md`, append one
line to `<agntux project root>/data/schema-requests.md`:

```
{ISO 8601 UTC} | - | request: {one-line summary} | source: "pattern-feedback-graduation: {brief evidence}"
```

Threshold: ≥ N items in 30-day window AND the pattern bullet has
appeared on 4+ calendar dates (softer than the 7-day graduation bar).
If `data/schema-requests.md` doesn't exist, create it with the
standard header. This is the only file outside `user.md` authority.

## Authority discipline

You only write to `user.md` (`updated_at` + `# Auto-learned`). You
never:

- Edit `# Identity`, `# Responsibilities`, `# Preferences/*`, or
  `# Glossary` — user-authority sections.
- Remove or rewrite existing `# Auto-learned` bullets. Append-only.
- Write to any other file — except `data/schema-requests.md`
  (append-only, threshold-gated; see "New-entity-type signal" above).

## Don't double-count

Before recording a pattern, scan existing `# Auto-learned` bullets. If
the same observation (matched by reason_class + entity, or by source +
reason_class) already has a bullet, skip — incrementing dismissals is
not new information.

## Be honest

If the 30-day window has nothing to learn from (light usage, no clear
patterns, all counts below N), do nothing. Exit cleanly. Empty runs
are correct behaviour; spurious bullets degrade the signal.

## Out of scope

- Conversational graduation review ("any patterns to approve?") →
  use `/agntux-profile`. That skill reads the `[graduation-candidate]`
  tags this skill has written and surfaces them to the user.
- Per-plugin instruction capture → `/agntux-teach {slug}`.
- Cross-workflow preference edits → `/agntux-profile`.
