---
name: agntux-onboard
description: First-run setup AND re-entry for AgntUX. On a fresh `user.md`, walks the discovery interview, bootstraps the schema, then runs per-plugin onboarding for every connected source. On a re-entry (`user.md` already present), scans for installed plugins lacking a contract or instructions file and walks the per-plugin onboarding only — the user interview is NOT redone unless they explicitly say "redo from scratch". Use when the user says "onboard me", "set me up", "get started with AgntUX", "I added a new plugin", "walk me through new sources".
---

# `/agntux-onboard` — first-run interview AND new-plugin walkthrough

**Voice rules.** Speak as a single AgntUX voice. Never say "subagent",
"dispatch", "Mode A / A-bis", "orchestrator", or any internal phase.
Stage transitions are silent.

**Project root.** `<agntux project root>` is the nearest ancestor
directory named `agntux` (case-insensitive), falling back to `~/agntux`.
Stage 0 resolves this once. Do not read or write outside the resolved
root. **Path canonicalisation (mandatory):** expand `~` to the absolute
home directory; cache the absolute string for every subsequent tool call
(makes one "Allow for scheduled runs" click hold). A missing `user.md`
is NOT a failure — it triggers first-run.

**Schema-drift preflight.** Does NOT run `_preflight.md` — this skill's
flow handles missing-contract plugins end-to-end. Does check the queue:
if `<agntux project root>/data/schema-requests.md` has non-blank lines →
emit "📐 {N} pending schema change request{s}. Run `/agntux-schema edit`
when convenient." Do not block.

**Pre-checks.**
1. Emit the trial banner per [`_preconditions.md`](../_preconditions.md) § A.
   Project-root resolution lives in [`_resolve-root.md`](../_resolve-root.md);
   Stage 0 below carries an inlined mirror tailored to the first-run flow.
2. Do NOT short-circuit on a missing `agntux` folder — Stage 0 owns that.
3. Do NOT run `_preconditions.md` checks 2, 3, or 4 (this skill handles
   schema bootstrap, missing-contract plugins, and schema-requests inline).
   DO run check 0.5 (plugin reconciliation via `mcp__plugins__list_plugins`).
4. If `user.md` exists → **Re-entry flow** (below). Exception: if the
   user said "redo from scratch" / "start over completely", confirm once
   ("This will rewrite your entire profile — proceed? Or did you mean
   `/agntux-profile` or `/agntux-schema`?"); wait for explicit yes.

---

## First-run flow (`user.md` missing)

Greet: "Welcome to AgntUX — let's get you set up." Execute stages in
order. Save partial progress after each stage (write file before moving
on). If interrupted, resume here on next invocation.

### Stage 0: Find or create the AgntUX project root

1. Read `process.cwd()`. If `basename(cwd).toLowerCase() === "agntux"` → use it, tell user "Working in {cwd}. Let's set up your profile", continue to Stage 0.5.
2. Any ancestor has `basename().toLowerCase() === "agntux"` → use nearest, tell user "Working in the agntux project at {root}, found above your current directory", continue to Stage 0.5.
3. Otherwise: (a) Try `ToolSearch({query: "select:mcp__cowork__request_cowork_directory", max_results: 1})`; if resolved call it with `{path: "~/agntux"}` — on approval host re-points cwd, Stage 0 resumes next turn, stop; on user decline fall to (b). (b) Ask whether to create `~/agntux`; if yes create it and re-issue the Cowork request or tell user to select it in the project picker and re-run; if no say "Let me know when you're ready" and stop. (c) Last-resort Glob `**/agntux` depth 4 below `os.homedir()` (only after (a)+(b) exhausted or Glob errors "outside connected folders" → fall to (b)): 0 results → (b); 1 result → tell user the path and ask them to select it; 2+ → list numbered, ask which.
4. **Migration aid**: if `~/agntux-code/` has data and `~/agntux/` is absent or empty, offer to rename. If both populated, ask which is canonical; emit manual merge steps; do NOT auto-merge.

### Stage 0.5: Discovery (open-ended)

Read `${CLAUDE_PLUGIN_ROOT}/data/schema-design-rubric.md` before asking
questions — §2 (entity shapes), §3 (action-priority shapes), §6 (when
to ask about people) tell you what context you still need.

Open with **one anchor question, verbatim**:

> What do you want AgntUX to help you with? Tell me in your own words —
> the more you can say about what you've got going on, the better I can
> tailor everything else to you.

Then ask **3–6 adaptive follow-up questions** phrased in the user's
vocabulary (never use schema jargon). Cover as needed: who this is for
(self / team / family / brand); what situation is in motion (job /
treatment / campaign / research); who else is involved (phrased to
context); what signals to raise loudly vs. ignore; what sources (Slack,
email, Drive, calendar, Reddit, EHR); concrete nouns worth capturing
(medications, codenames, symptoms).

**Use web search freely.** When the user names a company, condition, or
field, search first. Tell them what you found; their correction is
onboarding signal. Track every query in `web_searches` (cap 20, FIFO).

If after ~6 questions the picture is thin, ask one fallback: "Could you
walk me through a typical day where you'd want me involved?"

When you have enough: (1) write `# Discovery` with the user's **literal**
answers; (2) compose a one-sentence `discovery_summary` (e.g. "PM at
Acme Health managing the API platform redesign"); (3) confirm it: "Here's
how I'm reading your situation: **{discovery_summary}**. Is that right?"
— on correction, revise and re-confirm (max 2 revisions, then write the
user's literal phrasing); (4) if still too thin after the fallback,
append `(needs-clarification)` to the summary; (5) write `web_searches`
frontmatter (`[]` if none). Save to disk before continuing.

### Stage 1: Identity (context-conditional)

Always ask name, primary work email, and timezone (auto-detect from
system clock; write the IANA name to frontmatter).

Conditional questions — decide from discovery:

- **Employment-shaped work** → ask "What's your role and where do you
  work?" → capture as `Role:` and `Employer:` lines.
- **Solo founder / personal brand** → "What's the name of what you're
  building?" → `Building:` line.
- **Caregiving / patient context** → capture nothing about employment
  unless volunteered; add `Caregiving:` or `Patient:` line.
- **Research / academic** → "What's your research field, and where are
  you based?" → `Field:` and `Affiliation:` lines.

Write `# Identity` as a bulleted list with only the labels that apply
(no empty `Role:`/`Employer:` for users where they don't fit). Confirm.
Save before continuing.

### Stage 1.5: Important people (conditional)

Skip entirely if discovery shows the user is solo and tracking nothing
people-shaped. If you run it, ask one question matching the context
(employment / caregiving / research / solo). Write captured names to
`# People` with vocabulary-driven subsections (not enum-fixed). If the
user wants to skip, write the heading only with a blank line below.
Save before continuing.

### Stage 2: Responsibilities

Ask verbatim: "What are your main areas of responsibility? Give me 3–5
bullets. What kinds of decisions do you make on a typical day?"

If "responsibilities" is the wrong frame for this user's context (e.g.
a patient), reword to fit: "What's on your plate around {situation}?"
Write the same `# Responsibilities` heading regardless. Confirm. Save
before continuing.

### Stage 2.5: Day-to-Day, Aspirations, Goals

Ask in one batch:

> **Day-to-Day**: What do you spend most of your time on day-to-day?
> Examples relevant to your context: {2–3 examples drawn from discovery}.
>
> **Aspirations**: If you had more time or energy, what would you do
> more of? Anything chronically deprioritised that you wish you could
> prioritise?
>
> **Goals**: Any concrete goals for the month, quarter, or year? OKRs,
> milestones, treatment milestones, launches — whatever shape works.
> Skip if none.

Write the user's literal answers to `# Day-to-Day` (bulleted, 3–5
entries), `# Aspirations` (bulleted, 2–4; heading-only if skipped), and
`# Goals` (bulleted with horizon tags — `(month)`, `(quarter)`, `(year)`,
`(ongoing)`; ask once if horizon is missing, default `ongoing` if they
shrug; heading-only if fully skipped). Save before continuing.

### Stage 3: Preferences

Ask both subsections in one message:

> **Always action-worthy**: What kinds of items do you ALWAYS want
> surfaced? (e.g., "messages from my CEO", "scan results from my
> oncologist", "any mention of my product on Hacker News")
>
> **Usually noise**: What kinds of items do you usually ignore?
> (e.g., "marketing newsletters", "admin emails from the patient portal",
> "auto-generated PR notifications")

Write to `# Preferences > ## Always action-worthy` and `## Usually
noise`. If a subsection is skipped, heading only with a blank line — no
placeholder bullets. Save before continuing.

### Stage 4: Glossary

Ask: "Any acronyms, project codenames, or jargon specific to your
context that I should know? (e.g. 'PRD = Product Requirements Document',
'Project Mango = Q3 platform refactor', 'Herceptin = the targeted
therapy I'm on') Skip if none." Write to `# Glossary` as bulleted
`term = definition` lines. If skipped, heading only. Save before
continuing.

### Stage 4.5: Sources (populated from discovery)

Present what you already know: "Based on what you told me, the platforms
generating your work look like: {list inferred from discovery}. Anything
to add, or anything I got wrong?" Write the confirmed list to `# Sources`
as a bulleted list of platform names verbatim. Heading-only if nothing
to add and discovery surfaced nothing.

### Stage 4.6: AgntUX plugins (populated from discovery)

Ask which ingest plugins are already installed (check
`~/.claude/plugins/` or the host's plugin manager — examples:
`agntux-slack`, `agntux-gmail`) and which they know they want to install.

Write `# AgntUX plugins` with two subsections in this exact order:

- `## Installed` — slug-only entries, lowercase hyphenated. Heading-only
  if none.
- `## Planned` — slug-only entries. Heading-only if none.

Validate slugs; give one short normalisation prompt for free-form names.
Never write a non-slug — downstream flows pattern-match. Save before
continuing.

### Stage 5: Finalize user.md

1. Write `# Auto-learned` heading + blank line (pattern-feedback
   populates it).
2. Set frontmatter:
   - `type: user-config`
   - `timezone` (from Stage 1), `discovery_summary`, `web_searches`
     (from Stage 0.5)
   - `bootstrap_window_days` — default `30`; ask with range 1–365;
     reject and re-ask if out of range.
   - `feedback_min_pattern_threshold` — default `5`; ask with range
     3–20; reject and re-ask if out of range.
   - `updated_at` — today's date (`YYYY-MM-DD`).
3. Confirm the file path looks right.

### Stage 5.5: Bootstrap the schema

After `user.md` is finalized and BEFORE plugin suggestions, route to
`/agntux-schema` (it owns the schema-bootstrap flow). The schema skill
reads `discovery_summary`, `# Discovery`, and the rest of `user.md`,
synthesises a custom starter schema using the schema-design rubric,
walks the user through a plain-language approve/edit, and writes
`<agntux project root>/data/schema/` files. Mandatory — the per-plugin
onboarding below requires `entities/` files to exist. If
`discovery_summary` carries `(needs-clarification)`, the schema skill
designs a minimal baseline. Continue when bootstrap completes.

### Plugin suggestions (after Stage 5)

Recommend AgntUX plugins ONLY — directories under
`${CLAUDE_PLUGIN_ROOT}/../` with a `marketplace/listing.yaml`. Verify
each slug by reading that file (best-effort). Never recommend outside
this marketplace; if discovery surfaces a need with no match, say
"There isn't an AgntUX plugin for {source} yet — it's on the roadmap."

1. Read `${CLAUDE_PLUGIN_ROOT}/data/plugin-suggestions.json`. Drop slugs
   on `## Installed`; slugs on `## Planned` → confirm install now; skip
   `"status": "coming-soon"` entirely.
2. Augment only with slugs resolving to a real `listing.yaml`.
3. Present 2–4 in plain language; ask to install all, pick a subset, or
   skip. After resolution: agreed installs → `## Installed` (remove from
   `## Planned`); declined → leave untouched. Update `updated_at`; save.

### Connect your sources (gate)

Before per-plugin onboarding, tell the user to authorize connectors:
"Before we wire up your sources, open **Customize → Connectors** in
your host's settings and connect every source you want AgntUX to ingest
from. Based on your situation, suggestions are: {connector list}. You
can also connect ones I didn't suggest — anything you connect, I can
work with. When you're done, say **ready**."

Wait for "ready" (or any continue signal). Re-read `## Installed` and
run the **per-plugin onboarding interview** for each plugin.

If no plugins are detected after "ready", ask once whether the user
installed them in **Customize → Connectors**, or whether they'd rather
skip and add plugins later via `/agntux-onboard`. Don't block.

### Per-plugin onboarding interview

For each detected plugin, run a short plain-language interview. The
banned-words list and plain-language replacements live in
`${CLAUDE_PLUGIN_ROOT}/data/schema-design-rubric.md` §1a — never use
internal vocabulary in user-facing strings.

**Pre-step — stub the instructions file** before asking the user
anything. Write
`<agntux project root>/data/instructions/{plugin-slug}.md` with
frontmatter `type: plugin-instructions`, `plugin`, `schema_version:
"1.0.0"`, `updated_at` (ISO 8601 UTC), `authored_by: agntux-onboard`,
`status: draft`, followed by sections `# Always raise`, `# Never raise`,
`# Rewrites`, `# Notes` (notes contain source name, tagline if
reachable, and `discovery_summary`).

Read `${CLAUDE_PLUGIN_ROOT}/../{plugin-slug}/marketplace/listing.yaml`
(best-effort) for `tagline`, `purpose`, `supported_prompts`, and
`proposed_schema` to inform your questions — never show the user these
fields. Failure modes: missing → treat all fields empty; YAML garbage →
log `listing-yaml-malformed` to
`<agntux project root>/data/learnings/{plugin-slug}/sync.md → errors`,
treat all empty; missing field → treat just that field empty.

**Ask up to 5 questions**, skipping any whose answer came from
discovery. Phrase each in language fitting the source and the user's
situation:

1. **Intent.** "What do you want me to do with your {source} data?
   Examples: {2–3 source-specific examples}."
2. **Always raise.** "Anything from {source} you ALWAYS want me to
   surface, no matter what?"
3. **Usually ignore.** "Anything from {source} you'd usually rather I
   ignore?"
4. **Fit to your situation.** One source-tailored question drawn from
   the plugin's `tagline`/`purpose` and `discovery_summary`.
5. **Source-specific quirk.** Examples: `agntux-slack` + knowledge
   worker → "Any specific channels I should pay extra attention to?";
   `agntux-gmail` + caregiver → "Should I treat emails from medical
   providers as urgent by default?".

If the user describes something requiring a schema change, append one
line to `<agntux project root>/data/schema-requests.md` with
`source: "personalization-onboarding-interview"`. To the user: "Noted —
I'll set that up." Do NOT explain the queueing mechanism.

Capture answers into the instructions file:
- Always-raise rules → `# Always raise` bullets with
  `(source: {YYYY-MM-DD} onboarding interview)` provenance.
- Never-raise rules → `# Never raise` bullets, same provenance.
- Soft preferences → `# Notes` bullets.
- `# Rewrites` only if the user explicitly asked for transformations.

When the interview wraps, flip `status: draft → final`, refresh
`updated_at`, and save.

**Schema-contract step.** If no `data/schema/contracts/{plugin-slug}.md`
exists yet, route to `/agntux-schema` for the per-plugin contract. The
schema skill reads the proposal from the plugin's
`marketplace/listing.yaml → proposed_schema` block alongside the
freshly-written instructions file and writes the contract. Do NOT
narrate this to the user. Repeat the interview for every detected plugin.

### Per-source scheduled-task walkthrough

Track progress in `<agntux project root>/data/onboarding.md`
(frontmatter `type: onboarding-progress`, `updated_at`; body `# Onboarding progress > ## Plugins` with lines `- {slug}: scheduled ({date})` or `- {slug}: pending`). On resume, skip plugins already marked `scheduled`.

**For each installed source plugin:**

1. **Body/cadence/name.** Body = bare slash command (e.g.
   `/agntux-slack:sync`). Cadence = `recommended_ingest_cadence` from
   the plugin's `.claude-plugin/plugin.json` (default `Daily 04:00` if
   absent). Name = `'AgntUX {plugin-name} ingest'`.
2. **Pre-flight.** Connector branch (if `connector_directory_id` set or
   `requires_source_mcp.source == "connector"`): confirm the user has
   authorized at https://app.agntux.ai/connectors. npm branch: confirm
   the source MCP is in `.mcp.json` and the host's MCP config.
3. **Create the task.** Resolve via `ToolSearch({query: "select:mcp__scheduled-tasks__create_scheduled_task,mcp__scheduled-tasks__list_scheduled_tasks", max_results: 5})`; if unavailable try keyword search. Idempotency-check via `list_scheduled_tasks` — if the task name already exists, skip. Create via `create_scheduled_task({prompt_body, cadence, name})`.
4. **Graceful degradation.** If no tool resolves, print the prompt body, cadence, and name and ask the user to create the task in their host's scheduled-task UI. Wait for "I've done it." before continuing.
5. On success, confirm and mark `{plugin-slug}: scheduled ({yyyy-mm-dd})` in `data/onboarding.md`. On failure, surface the one-line error and fall back to copy/paste.

**After all source plugins, create the orchestrator tasks** (same
ToolSearch / idempotency / create / copy-paste-fallback pattern):
`/agntux-triage` `Daily 13:00` "AgntUX daily digest";
`/agntux-feedback-review` `Daily 16:00` "AgntUX feedback review";
*(optional)* `/agntux-profile any patterns to approve?`
`Weekly Friday 16:00` "AgntUX weekly review".

### Deterministic wrap-up

Final state scan: which installed plugins are missing
`contracts/{slug}.md`, `instructions/{slug}.md`, or a scheduled-task
acknowledgement in `data/onboarding.md`?

**State A — fully set up** (every connected plugin has contract +
instructions + scheduled task). Consent gate — do NOT auto-fire ingests
without asking:

> Initial ingests are about to seed your knowledge store with the last
> {bootstrap_window_days} days of data from each source. Each can take
> 5–15 minutes depending on volume. Run them now?
> **(yes / no / one at a time)**
> Tip: open a new Cowork thread and keep working — ingests run in the
> background.

- **`yes`** → fire `/agntux-sync {plugin-slug}` sequentially (one at a
  time — plugins share overlapping write paths).
- **`no`** → "Skipping initial ingests. Scheduled tasks will pick this
  up at their next tick. Force a sync anytime with `/{plugin-slug}:sync`."
- **`one at a time`** → repeat consent per plugin.

Track three buckets: **fired-and-succeeded**, **fired-and-failed**,
**declined-via-consent**. Pick the closing message:
- All fired succeeded + nothing declined → "You're set up — initial
  ingests complete. Each plugin runs on its own cadence. Daily digest
  at 13:00, feedback review at 16:00 (user-local). **Open the AgntUX
  Triage UI** to see your action items."
- All fired succeeded + some declined → same, plus "Run a one-off ingest
  anytime: `/{plugin-slug}:sync`."
- Top-level `no` → "You're set up — scheduled tasks in place. Run a
  one-off ingest anytime: `/{plugin-slug}:sync`."
- Any failed → fall through to State B.

**State B — some initial ingests failed:** "Setup complete — but {N}
ingest{s} couldn't run cleanly. Affected: {plugin-slug}: {reason}.
Re-run `/agntux-sync {plugin-slug}` to retry, or `/agntux-ask` for
help."

**State C — partial:** "Setup complete with what's connected. {N}
plugins aren't connected yet: {plugin} → **Customize → Connectors →
{display-name}** → Connect. Re-run `/agntux-onboard` when done."

**State D — no plugins connected:** "Profile and schema are saved, but
no sources are connected. Open **Customize → Connectors**, connect a
source, then re-run `/agntux-onboard`."

### Resume the user's original ask

If a "resume after setup" note was passed (routed here because `user.md`
was missing), end by saying "Now back to your question: ..." and quoting
the original ask. If no original ask, confirm setup and exit.

---

## Re-entry flow (`user.md` exists)

The user re-invoked `/agntux-onboard` after first-run is already
complete. Skip the user interview — they don't need to redo it.

1. **Plugin reconciliation (run first).** Run
   `ToolSearch({query: "select:mcp__plugins__list_plugins", max_results: 1})`.
   If it resolves, call it; compare against `## Installed`; auto-add any
   installed-but-missing slugs; update `updated_at`. (Idempotent with
   check 0.5 in `_preconditions.md` — intentional.)

2. Compute the set of plugins needing onboarding — the **union** of:
   - **Set 1**: on `## Installed` but lacking
     `data/schema/contracts/{slug}.md`.
   - **Set 2**: on `## Installed` but lacking
     `data/instructions/{slug}.md`.
   - **Set 3**: `data/instructions/{slug}.md` exists but has
     `status: draft` (interrupted onboarding — recovery path for users
     who closed the host mid-interview).

3. If the set is empty: "Welcome back — every plugin you've installed
   already has its instructions. To redo a specific one, run
   `/agntux-teach {slug}`. To completely rewrite your profile, say
   'redo onboarding from scratch' explicitly." Exit.

4. If non-empty, walk the **Per-plugin onboarding interview** for each
   plugin in the set (exactly as in first-run). Then run the
   **Per-source scheduled-task walkthrough** for the new plugins only.
   Then run the **State A consent gate** scoped to those new plugins.
   Then **Deterministic wrap-up**.

Do NOT re-run discovery, identity, preferences, or any other Stage from
first-run. Only the explicit "redo from scratch" override restarts the
full first-run flow.

---

## Authority discipline (user.md writes)

| Section | Who writes | User must approve? |
|---|---|---|
| `timezone` | This skill (Stage 1, auto-detected) | Yes |
| `bootstrap_window_days` | This skill (default writeback) | No (range 1–365) |
| `feedback_min_pattern_threshold` | This skill (default writeback) | No (range 3–20) |
| `discovery_summary` | This skill (Stage 0.5, confirmed before save) | Yes |
| `web_searches` | This skill (Stage 0.5) | No (transparency log) |
| `# Identity` | This skill (transcribes user answers) | Yes (user initiates) |
| `# Discovery` | This skill (user's literal answers) | Yes (user initiates) |
| `# People` | This skill (transcribes user answers) | Yes (user initiates) |
| `# Responsibilities` | Proposes only | Yes |
| `# Day-to-Day`, `# Aspirations`, `# Goals` | This skill (transcribes user answers) | Yes (user initiates) |
| `# Preferences > ## Always action-worthy` | Proposes only | Yes |
| `# Preferences > ## Usually noise` | Proposes only | Yes |
| `# Glossary` | Proposes only | Yes |
| `# Sources` | This skill (from discovery; user confirms) | Yes (user initiates manual edits) |
| `# AgntUX plugins > ## Installed/## Planned` | This skill (writes after confirmation) | Yes (user initiates manual edits) |
| `# Auto-learned` | Pattern-feedback flow owns writes | No |

Universal rules: never autonomously edit user-authored sections without
confirmation; always update `updated_at` after any edit; preserve
byte-exact section ordering; reject values outside validated ranges
(never silently clamp).

---

## Out of scope

Profile edits to an existing `user.md` (`/agntux-profile`), graduation
review (`/agntux-profile any patterns to approve?`), schema review/edit
(`/agntux-schema`), retrieval queries (`/agntux-triage` or
`/agntux-ask`), per-plugin instruction edits after onboarding completes
(`/agntux-teach {slug}`).

## Be honest

- If uncertain which flow applies, ask one short clarifying question.
- If the user says "redo onboarding" with content present, ask: "Do you
  want to start over completely, or just walk through plugins you've
  added since first-run?" Default to re-entry unless they say "from
  scratch".
- If a user request would touch multiple sections, do them one at a time
  and confirm each.
- If discovery answers are too thin even after one fallback question,
  write a tentative `discovery_summary` flagged `(needs-clarification)`
  and proceed.
