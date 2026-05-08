# `/agntux profile` — personalization edits

Lane: any edit to `<agntux project root>/user.md`. Cross-workflow rules
and identity live here; per-plugin/per-source rules go through
`/agntux teach` instead.

## Contents

- Detect mode
- Mode B: Ongoing edits
- Mode C: Graduation review
- Mode D: Proactive ask
- Authority discipline table
- Lane disambiguation
- Be honest

## Detect mode

Read `<agntux project root>/user.md`.

| Condition | Mode |
|---|---|
| Prompt is "edit my profile" / "set up my X plugin task" / a specific section edit | B — ongoing edits |
| `# Auto-learned` has ≥1 `[graduation-candidate]` tag AND prompt is "any patterns to approve?" or graduation-prompt scheduled task | C — graduation review |
| Orchestrator forwarded "user mentioned \<thing\> that may belong in user.md" | D — proactive ask |
| Prompt is a specific edit ("add X to action-worthy") | B — targeted edit |

If genuinely ambiguous, ask one short clarifying question.

---

## Mode B: Ongoing edits

The user wants to update one specific thing. Do not re-walk the
onboarding interview.

1. Identify which section is being edited. Map per the authority
   discipline table below.
2. Read the current file, capture the section, edit minimally, write
   back. Update frontmatter `updated_at`.
3. Confirm to the user: "Added 'Globex escalations' to your
   `## Always action-worthy`."

**Special case — cadence change request**: If the user asks to change a
cadence ("change my Slack ingest cadence to every 4 hours"), say:
"I can change cadences for you. Tell me which task and the new cadence —
I'll update it via the host's scheduled-task tool. (If the host doesn't
expose programmatic edit, I'll fall back to telling you to open the
scheduled-task UI yourself.)"

Then call the host's scheduled-task update tool with the new cadence.
On success, confirm: "Updated {task-name} to {cadence}." On failure or
tool unavailability, fall back to: "I couldn't update it
programmatically — open your host's scheduled-task UI, find
{task-name}, change the frequency to {cadence}, and Save."

Do not write anything to `user.md` for cadence. Cadence is not stored
in `user.md`.

**Special case — `bootstrap_window_days` edit**: Update the frontmatter
value. Validate range 1–365 before writing.

**Special case — `feedback_min_pattern_threshold` edit**: Update the
frontmatter value. Validate range 3–20 before writing.

---

## Mode C: Graduation review

The pattern-feedback flow left `[graduation-candidate: ## Usually noise]`
(or `[graduation-candidate: ## Always action-worthy]`) tags on
`# Auto-learned` bullets. Surface them to the user one at a time.

1. Read `user.md`. Find every line in `# Auto-learned` ending with a
   `[graduation-candidate: ...]` tag.
2. For each candidate, present the proposal (one at a time — do not
   batch):

   > "For 7 days running you've dismissed marketing newsletters from
   > acme-marketing. Should I add 'Marketing newsletters from
   > acme-marketing' to your `## Usually noise` list?"

   Wait for the user to respond before moving to the next candidate.

3. **On approval**: add the line to the relevant `# Preferences`
   subsection. Strip the tag from the `# Auto-learned` bullet. Update
   `updated_at`.
4. **On rejection**: strip the tag, append a
   `[user-rejected {yyyy-mm-dd}]` annotation so pattern-feedback knows
   not to re-tag. Update `updated_at`.
5. If there are no candidates: "Nothing to review — your preferences
   are up to date." Exit cleanly.

---

## Mode D: Proactive ask

The orchestrator forwards: "User mentioned X in the last conversation
that may belong in user.md." Examples:

- "User dropped 'OKRs' in conversation; possible glossary entry."
- "User referred to 'top-30 accounts'; current preference says
  'top-10' — possible update."

1. Form one short proposal — but **never invent the definition**. Ask:
   "You mentioned OKRs — do you want to add a definition to your
   glossary?" If yes: "How would you define it for your context?" Then
   write the user's literal answer.
2. On approval, do the edit (Mode B path).
3. On rejection, drop it.
4. Don't chain proposals. One ask per spawn.

**Structural-intent direct write.** If the user expressed an intent
that requires a schema change (e.g., "I want to track sentiment per
company", "track NPS per deal"), append one line to
`<agntux project root>/data/schema-requests.md` directly with
`source: "personalization-mode-D"`:

```
{ISO 8601 UTC} | - | request: {one-line summary} | source: "personalization-mode-D: {user quote, ≤200 chars}"
```

Acknowledge in one sentence ("Noted — I'll have the architect set that
up on the next round.") and end your turn. Do NOT route through
user-feedback first; that hop was removed.

**Source-specific imperatives still cross-link.** If the user expresses
an imperative about a specific source ("never raise email from X",
"ignore #random"), do NOT capture in `user.md`. That belongs in
`<agntux project root>/data/instructions/{plugin-slug}.md`, owned by
`/agntux teach`. Acknowledge in one sentence and end your turn.

---

## Authority discipline table

| Section | May edit autonomously? | User must approve? | Notes |
|---------|------------------------|---------------------|-------|
| frontmatter `timezone` | Yes (with auto-detect) | Yes | Set once; rarely changes. |
| frontmatter `bootstrap_window_days` | Yes (default writeback) | No (sensible default) | Range 1–365. |
| frontmatter `feedback_min_pattern_threshold` | Yes (default writeback) | No | Range 3–20; default 5. |
| frontmatter `discovery_summary` | Proposes only | Yes | LLM-composed paraphrase; user must approve. |
| frontmatter `web_searches` | Yes | No | Transparency log of queries run during discovery. |
| `# Identity` | Yes (transcribes user answers) | Yes (user initiates) | No autonomous edits. |
| `# Discovery` | Yes (transcribes user's answers) | Yes (user initiates) | The user's situation in their own words. |
| `# People` | Yes (transcribes user answers) | Yes (user initiates) | Vocabulary-driven subsection names. |
| `# Responsibilities` | Proposes only | Yes | No autonomous writes. |
| `# Day-to-Day` | Yes (transcribes user answers) | Yes (user initiates) | |
| `# Aspirations` | Yes (transcribes user answers) | Yes (user initiates) | |
| `# Goals` | Yes (transcribes user answers) | Yes (user initiates) | Horizon tags `(month)\|(quarter)\|(year)\|(ongoing)`. |
| `# Preferences → ## Always action-worthy` | Proposes only | Yes | Graduates from `# Auto-learned`. |
| `# Preferences → ## Usually noise` | Proposes only | Yes | Graduates from `# Auto-learned`. |
| `# Glossary` | Proposes only | Yes | User can also add directly. |
| `# Sources` | Yes (confirms with user) | Yes (user initiates manual edits) | Filters plugin suggestions. |
| `# AgntUX plugins → ## Installed` | Yes (after user confirmation) | Yes (user initiates manual edits) | Slug-only; one slug per bullet. |
| `# AgntUX plugins → ## Planned` | Yes (clears when promoted) | Yes (user initiates manual edits) | Slug-only; one slug per bullet. |
| `# Auto-learned` | Yes (pattern-feedback owns writes; strip graduation tags in Mode C) | No | User may curate/delete. |

**Universal rules:**

- User-authored sections (`# Identity`, `# Discovery`, `# People`,
  `# Responsibilities`, `# Day-to-Day`, `# Aspirations`, `# Goals`,
  `# Preferences/*`, `# Glossary`, `# Sources`, `# AgntUX plugins/*`):
  never autonomously edit without user confirmation. Take their literal
  answer; ask for confirmation if you paraphrased.
- `# Auto-learned`: agent-authored (pattern-feedback owns writes; you
  strip graduation tags in Mode C).
- Always update frontmatter `updated_at` after any edit.
- Preserve byte-exact ordering of unrelated sections — never reflow
  whitespace or move headings.

---

## Lane disambiguation

- "Teach `{plugin}`" / source-specific imperatives ("never raise email
  from X", "ignore #random") → use `/agntux teach` — those write
  per-plugin instructions, not `user.md`.
- Schema/data-model edits ("add a `health_score` field to `company`",
  "add an `awaiting-customer` action class") → use `/agntux schema`.
- Cadence changes for ingest plugins → handled via the host's
  scheduled-task tool (Mode B special case above); cadence is not
  stored in `user.md`.

## Be honest

- If you can't tell which mode you're in, ask one short clarifying
  question.
- If a user request would touch multiple sections, do them one at a
  time and confirm each.
- If a user provides a value outside a validated range, reject and
  re-ask. Never silently clamp.
