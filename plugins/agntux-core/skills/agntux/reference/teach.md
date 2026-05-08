# `/agntux teach` — per-plugin instructions

Lane: any rule that names a specific plugin or source. Cross-workflow
preferences belong in `/agntux profile` (writes `user.md`); rules here
live in `<agntux project root>/data/instructions/{plugin-slug}.md`.

(`teach` cannot run before the schema is bootstrapped — the
data-architect's plugin contract is the authority for which
`{plugin-slug}` values are valid.)

## Contents

- Detect mode
- Mode A: Capture
- Mode B: Teach interview
- Mode C: Structural escalation
- Authority surface
- Honesty rules

---

## Detect mode

| Trigger | Mode |
|---|---|
| User said an imperative in chat (e.g., "never flag email from notifications@*", "always raise PRs from @teammate") | A — capture |
| `/agntux teach {plugin-slug}` invoked directly | B — teach interview |
| User said something structural that doesn't fit a triage rule (e.g., "track customer sentiment per company") | C — structural escalation |

If ambiguous (could be triage rule or structural ask), default to
Mode A, then surface the structural follow-up at the end so Mode C
runs next.

---

## Mode A: Capture

Classify the imperative, identify the plugin slug, append to that
plugin's instructions file, confirm.

### Triage-button fast-path

When the inbound prompt matches `/items like ([\w-]+)\s*\(reason_class:\s*([^,]+?)\s*,\s*source:\s*([^)]+?)\s*\)/i` (the "Stop raising items like this" button dispatch):

1. Capture `id`, `reason_class`, `source` from the match. If either is literal `unknown`, fall through to standard flow.
2. Resolve plugin slug from `source` (`slack` → `agntux-slack`, `email`/`gmail` → `agntux-gmail`, etc.). Unresolvable slug → fall through to standard flow.
3. Append under `# Never raise` in `data/instructions/{plugin-slug}.md`:
   ```
   - {reason_class} from {source}: stop raising
     (source: {YYYY-MM-DD} triage button — items like {id})
   ```
   Create the file with standard frontmatter + four section headings if it doesn't exist.
4. Update frontmatter `updated_at`. Save atomically.
5. Reply with exactly one line: `Captured: stop raising {reason_class} from {source}.` and stop.

On any failure (write error, unresolvable slug), surface one short
error sentence and stop — do not fall back to the interactive flow.

### Stage 1 — Identify the plugin slug

- Orchestrator may pass the slug directly.
- Infer from the imperative: "email"/"inbox" → check `data/schema/contracts/` for installed email plugins; "Slack"/"channel"/"DM" → `agntux-slack`; "ticket"/"Jira" → `agntux-jira`.
- No plugin matches → offer to save under a stub file or skip; default to skip if unanswered.

### Stage 2 — Classify the rule

Slot into the appropriate section of
`data/instructions/{plugin-slug}.md`:

- `# Always raise` — "always flag X", "raise anything from Y", VIP signals.
- `# Never raise` — "never raise X", "ignore Y", wildcard sender patterns.
- `# Rewrites` — label / priority transformation requests.
- `# Notes` — soft preferences ("keep action descriptions terse").

If the imperative spans sections (e.g., "never raise newsletters except
from acme.com"), split into two bullets.

### Stage 3 — Append to instructions file

If the file doesn't exist, create it:

```markdown
---
type: plugin-instructions
plugin: {plugin-slug}
schema_version: "1.0.0"
updated_at: {ISO 8601 UTC}
authored_by: agntux-teach
status: final
---

# Always raise

# Never raise

# Rewrites

# Notes
```

If the file exists with `status: draft` (stubbed by onboarding), keep
`status: draft` — Mode A appends without promoting status.

Append the bullet in the format:
```
- {rule, ≤120 chars}
  (source: {YYYY-MM-DD} user said in chat)
```

Update `updated_at`. Save atomically.

### Stage 4 — Confirm

> Got it — I'll {paraphrase the rule} starting on its next run.

No follow-up questions. One rule captured, one confirmation, done.

---

## Mode B: Teach interview

`/agntux teach {plugin-slug}` was invoked. Run an on-demand re-walk —
the first-time install interview is owned by `/agntux onboard`.

### Stage 1 — Read context

1. `<agntux project root>/user.md` — `# Identity`, `# Day-to-Day`, `# Aspirations`, `# Goals`, `# Preferences`, `# Glossary`, `# AgntUX plugins > ## Installed`. If `{plugin-slug}` doesn't appear in the installed list, note it in one sentence and continue.
2. `<agntux project root>/data/schema/contracts/{plugin-slug}.md` — approved contract (what entity subtypes and action_classes the plugin can write).
3. `<agntux project root>/data/schema/entities/_index.md` — full subtype list for context.
4. Existing `data/instructions/{plugin-slug}.md` if present — extend, don't overwrite.

### Stage 2 — Run the interview

Open with: "Quick teach for {plugin-slug} — I'll ask 4 to 8 short
questions so I know what to surface and what to skip. Skip any question
with "skip" and I'll use sensible defaults."

Ask 4–8 questions in conversational batches of 2–3 per turn. Tailor to
the plugin and what `user.md` already tells you. Example probes:

- **Always-raise:** goals / key people / projects that should always surface.
- **Never-raise:** noise senders, auto-generated digests, archived content, reflexively-dismissed keywords.
- **Threshold:** deadline buffer in days (default 7); lean toward raising or staying quiet when borderline (default: raise).
- **Plugin-specific:** for email — VIP domains, deprioritize domains; for Slack — always-action channels vs. noise channels; for Jira — boards/sprints; for notes — skip tags/filename patterns.

Cap at 8 questions. Stop earlier if the user answers tersely.

### Stage 3 — Synthesise and write

Convert answers to structured bullets in the appropriate sections.
Paraphrase into rule form — never paste user free-text verbatim. If the
user raised something structural during the interview, slot it to
Mode C: append to `data/schema-requests.md` and tell the user the
architect will follow up.

Write (or extend) `data/instructions/{plugin-slug}.md`. Update
`updated_at`, set `status: final`.

Confirm:
> {N} rules captured for {plugin-slug}. Refine anytime ("never raise X from {plugin-source}") or run `/agntux teach {plugin-slug}` again for a full re-walk.

---

## Mode C: Structural escalation

The request implies a schema change, not a triage rule.

**Structural** (escalate): new field on an existing subtype, new
required frontmatter field, new subtype, new action_class, change to
field semantics or enum values.

**Not structural** (Mode A): triage filter, priority threshold,
stylistic preference.

If unsure, ask one question: "Are you asking me to track {field} as a
piece of data, or to use it as a filter for what's surfaced?"
Field-tracking → structural; filter → Mode A.

### Action

1. Identify plugin slug (or `-` for cross-cutting requests).
2. Append one line to `<agntux project root>/data/schema-requests.md` (create with frontmatter if absent):
   ```
   {ISO 8601 UTC} | {plugin-slug or `-`} | request: {one-line summary, ≤200 chars} | source: "{verbatim user quote, ≤200 chars}"
   ```
   Update frontmatter `updated_at`. Atomic write.
3. Tell the user:
   > That'll need a schema change ({proposed change in plain English}). I'll have the architect follow up on your next AgntUX session so we can decide together.

Do NOT write anything to `data/schema/` or fake the structural change
as a triage rule in `data/instructions/`.

---

## Authority surface

- `data/instructions/{plugin-slug}.md` — read + write (you author these).
- `data/schema-requests.md` — append-only.
- `user.md`, `data/schema/`, `entities/`, `actions/`, `data/learnings/` — read-only context; never write.

---

## Honesty rules

- Can't classify an imperative confidently → ask one short question rather than guessing.
- User asks for the impossible ("never raise anything that doesn't matter") → say so; ask for concrete signals to use as a proxy.
- Mode B interview turns up nothing actionable → write the file with just the frontmatter and four empty section headings. Sensible defaults prevail.
- Honesty over completeness: an honest "skip" beats a speculative rule.
