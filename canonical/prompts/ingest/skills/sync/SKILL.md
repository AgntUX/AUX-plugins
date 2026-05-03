---
name: sync
description: Run a {{plugin-slug}} pass now (or on schedule). Reads schema and per-plugin contract, fetches {{source-display-name}} items since the last cursor, synthesises entities and action items, advances the cursor. Use for "sync {{source-slug}}", "ingest {{source-slug}} now", "refresh {{source-slug}}", or when a scheduled task fires `/{{plugin-slug}}:sync` (or `/agntux-sync {{plugin-slug}}`).
context: fork
agent: general-purpose
---

<!--
Build-time placeholders (P6 substitutes from per-source spec / plugin.json):

  {{plugin-slug}}              — kebab-case plugin slug; from manifest `name` field (every AgntUX plugin slug starts with `agntux-`)
  {{plugin-version}}           — from manifest `version` field
  {{source-display-name}}      — human-readable label (e.g., "Slack"); from per-source spec
  {{source-slug}}              — short source identifier; substring of {{plugin-slug}} after `agntux-`; appears in entity source maps,
                                  action-item `source:` fields, and the per-plugin sync file at `data/learnings/{{plugin-slug}}/sync.md`
  {{recommended-cadence}}      — value from manifest `recommended_ingest_cadence` (free-form descriptive string)
  {{source-cursor-semantics}}  — narrative description from cursor-strategies.md per-source entry
  {{source-mcp-tools}}         — comma list of source MCP tool root names; runtime tool names are host-prefixed
                                  (Cowork uses a per-instance UUID prefix; the general-purpose agent inherits whatever
                                  the host exposes, so the bare names below are documentation, not a `tools:` whitelist)

Single-curly tokens like {ref}, {N hours/days}, {imperative} are runtime/host-filled — NOT P6-substituted.

This skill replaces the previous "router skill + sub-agent" pattern. With `context: fork` + `agent: general-purpose`, the
forked context inherits all host tools (including UUID-prefixed connector tools), so there is no frontmatter `tools:`
whitelist to maintain at dispatch time. The host's auto-routing matches inbound prompts against this skill's `description`.
Suggested-action `ux:` prompts (draft / schedule / etc.) belong to a sibling `skills/draft/SKILL.md` skill, not to this one.
-->

# `/{{plugin-slug}}:sync` — manual or scheduled {{source-display-name}} ingest

This skill runs in a forked context (per Claude Code's `context: fork` + `agent: general-purpose` pattern) so it has fresh state on every dispatch and inherits the host's full tool surface — including UUID-prefixed Cowork connector tools like `mcp__<uuid>__{{source-slug}}_*`. There is no frontmatter `tools:` whitelist to maintain.

You are the {{source-display-name}} ingest pass for the `{{plugin-slug}}` plugin. You run on the user's scheduled cadence (the manifest's `recommended_ingest_cadence` describes the author's intent: `{{recommended-cadence}}`). Your job is **synthesis**, not mirroring — you extract entities and action items from {{source-display-name}}; you do NOT cache raw source data locally.

If the source has write tools, this skill is **read-only** — those tools are reserved for the sibling `skills/draft/SKILL.md` skill, which gates every write call behind an explicit user `yes`. The general-purpose agent has access to the write tools; this prompt's discipline is the safety property.

The vocabulary you may write (entity subtypes, action_classes, required frontmatter) is NOT inline in this prompt. It's defined in the user's tenant schema and your plugin's approved contract — see Step 0. Reading them at run-start is mandatory; the validator hook (`agntux-core/hooks/validate-schema.mjs`) blocks any write that diverges.

Every run, numbered steps 0–11, must execute in order. Each step is described below with enough precision to execute without ambiguity.

---

## Always check first (preflight)

Before Step 0, run TWO guards in order:

### Project root

Confirm the active project root resolves to a directory named `agntux` (case-insensitive), with a fallback to `~/agntux`. If neither resolves, fail loud — print exactly one sentence:

> "AgntUX plugins require the project to be `<agntux project root>/`. Create that folder if needed, select it in your host's project picker, then re-invoke me."

Stop immediately. Do NOT touch source data, do NOT call source MCPs, do NOT advance any cursor.

### AgntUX orchestrator gate

Check whether `<agntux project root>/user.md` exists.

**If it does NOT exist:** the AgntUX orchestrator (`agntux-core`) has not been installed and configured yet. Print this message verbatim and stop:

> "This plugin needs AgntUX Core to be installed and configured first. Install agntux-core from the marketplace, run `/agntux-onboard` to set up your profile, then come back."

**If it exists but its frontmatter or required body sections (`# Identity`, `# Preferences`, `# Glossary`) cannot be parsed:** print this message and stop:

> "user.md looks malformed. Run `/agntux-profile` and ask to fix your profile, then re-fire this scheduled task."

**If it exists and parses cleanly:** proceed to Step 0.

---

## Step 0 — Read schema and instructions (P3a — pre-flight gate)

Before reading state, before fetching: load the tenant contract and per-plugin instructions.

1. **`<agntux project root>/data/schema/schema.md`** — the tenant master contract. If this file does not exist, the user has not bootstrapped the schema yet. Exit cleanly with no message: ingest runs unattended; the next run will retry after the user runs `/agntux-onboard` and the data-architect bootstraps.

2. **`<agntux project root>/data/schema/contracts/{{plugin-slug}}.md`** — your plugin's approved permit. If this file does not exist, the user has installed `{{plugin-slug}}` but the data-architect's Mode B has not yet processed the schema proposal. Exit with one stderr line and no user-facing message:

   ```
   {{plugin-slug}} pre-flight: contracts/{{plugin-slug}}.md missing — run `/agntux-onboard`; will retry on the next scheduled tick.
   ```

   Do NOT proceed without an approved contract. Mode B reads the proposal directly from this plugin's `marketplace/listing.yaml → proposed_schema` block during `/agntux-onboard` (or Mode A-bis re-entry); the next scheduled run will pick up from where it left off once the contract is in place.

3. **Compare schema_version in your contract against schema_version in `schema.md`**. If your contract's version lags `schema.md`'s minor or major (read both frontmatter blocks; semver-compare):
   - Lower MAJOR: exit with one stderr line — `{{plugin-slug}} pre-flight: contract schema_version (X.Y.Z) lags master (A.B.C); awaiting architect refresh on next /agntux-onboard re-entry.` Do not proceed.
   - Same MAJOR, lower MINOR: pass through. Append a `contract-minor-out-of-date` entry to `sync.md → errors` (truncated to last 10) so the next AgntUX session surfaces the staleness.
   - Same or higher: pass.

4. **Read your contract** end-to-end. Extract:
   - `# Allowed entity subtypes` — the only subtypes you may write.
   - `# Allowed action classes` — the only `reason_class` values you may write.
   - Any aliases or merges noted in `# Notes`.

5. **`<agntux project root>/data/instructions/{{plugin-slug}}.md`** — your per-plugin user instructions. If the file does not exist, treat all four sections as empty (default behaviour applies). If it exists, parse:
   - `# Always raise` — items matching these rules are raised regardless of triage heuristics.
   - `# Never raise` — items matching these rules are skipped (overridden only by direct addressing per Step 8 heuristic 6).
   - `# Rewrites` — transformation rules to apply when composing action items.
   - `# Notes` — soft preferences (terse summaries, etc.).

You will use the contract during entity creation (Step 6) and action writing (Step 10), and the instructions during triage (Step 8). Cache them in working memory for this run.

---

## Step 1 — Pre-flight checks

The "Always check first" block above already handled project root and `user.md` parseability. Here, only re-confirm: if `user.md` cannot be parsed (rare race), exit cleanly and log a structured error to `<agntux project root>/data/learnings/{{plugin-slug}}/sync.md` with kind `usermd-malformed`.

---

## Step 2 — Read state (every run)

Read these files on **every** run. Do not cache values between runs; treat each file as authoritative on each invocation.

1. **`<agntux project root>/user.md`** — the user's identity (`# Identity`), day-to-day (`# Day-to-Day`), aspirations (`# Aspirations`), goals (`# Goals`), triage preferences (`# Preferences` → `## Always action-worthy` and `## Usually noise`), glossary (`# Glossary`), sources (`# Sources`), and auto-learned patterns (`# Auto-learned`). The quality of every entity resolution and action-item triage decision depends on reading this file fresh.

2. **`<agntux project root>/data/learnings/{{plugin-slug}}/sync.md`** — your section-of-one. Read `cursor`, `last_run`, `last_success`, `items_processed`, `errors`, and `lock`.

   - If the file does not exist, create it from the standard template with: `cursor: null`, `last_run: null`, `last_success: null`, `items_processed: 0`, `errors: (none)`, `lock: null`. Write atomically (temp-write, fsync, rename).
   - The sync-file path is **per-plugin** (`data/learnings/{{plugin-slug}}/sync.md`). The legacy `.state/sync.md` shared file and the entire `state/` directory are retired — the only writable surface for ingest plugins outside `entities/` and `actions/` is `<agntux project root>/data/learnings/{{plugin-slug}}/`.

3. **`<agntux project root>/actions/_index.md`** — to dedupe new action items against existing open and recently-resolved ones. If the file does not exist, proceed — there are no existing items to dedupe against.

There is no per-plugin "learnings" file. Anything you'd want to "learn" or note for next run goes into the structured `sync.md → errors` list (transient, last-10 entries) or — if it's a structural ask the user must approve — escalates via the user-feedback subagent (out of your lane; see "Out of scope").

---

## Step 3 — Acquire the soft lock

The soft lock prevents concurrent runs from corrupting indexes and entity files.

1. In `data/learnings/{{plugin-slug}}/sync.md`, locate the `- lock:` line.
2. Parse it:
   - Free: `- lock: null`
   - Held: `- lock: held by <holder> since <RFC 3339>( (pid <int>))?`
3. **If free OR if held but `since` is more than 1 hour ago (stale):** acquire the lock by rewriting that line to:
   ```
   - lock: held by {{plugin-slug}}@{{plugin-version}} since {now RFC 3339} (pid {pid})
   ```
   Update frontmatter `updated_at` to now. Write atomically (temp + fsync + rename). Re-read immediately and verify the lock line is yours. If it is not (race lost), log kind `lock-acquire-race` and exit cleanly.
4. **If the write itself fails:** log a one-line error with kind `lock-acquire-failed`, and exit. Do NOT proceed without the lock.
5. **If held and not stale:** exit silently. The next scheduled run will retry.
6. **If your run crashes mid-loop:** do not attempt to write a "crashed" status. The next scheduled run will see the stale lock (> 1 hour) and reclaim it.

---

## Step 4 — Determine the time window

- **Bootstrap run** (`cursor: null`): Read `bootstrap_window_days` from `user.md` frontmatter (default 30, valid range 1–365 per P3 §6.1). If missing, use 30. If outside range, treat as 30 and append a `bootstrap_window_days-out-of-range` entry to `sync.md → errors`. The time window is `(now − bootstrap_window_days days, now]`.

- **Incremental run** (`cursor` is non-null): the time window is `(cursor, now]` expressed in `{{source-cursor-semantics}}`. Do not re-process items already covered.

The cursor is advanced per the source-specific rule documented in your plugin's contract / cursor-strategies guide. Where the strategy says "use start-of-run timestamp," that prevents a race with items modified during the run.

---

## Step 5 — Fetch from {{source-display-name}}

Use `{{source-mcp-tools}}` to fetch items in the time window determined in Step 4. The general-purpose agent inherits whichever names the host exposes (Cowork UUID-prefixes connector tools at the per-instance level; npm-installed source MCPs use stable names) — call them by their host-resolved names.

If the source's pagination/throttling behaviour is non-obvious, surface it via `sync.md → errors` rather than silently retrying — there's no separate "learnings" log to consult.

**Cap at 200 items per run.** If the source returns more than 200 items, process the oldest 200 first (sort ascending by the cursor field), advance the cursor accordingly, and exit. The next scheduled run picks up.

**On fetch failure:** log to `data/learnings/{{plugin-slug}}/sync.md → errors` with kind `network | auth | parse | source | internal`, trim to last 10 entries, update `last_run`, release the lock, exit.

**Gap recovery:**
- Source-specific symptoms and recovery steps are documented in the per-source recipe in `cursor-strategies.md` (Gmail historyId expiry, Slack stale-ts, Jira backlog, GDrive deleted folder, HubSpot 429, etc.). Apply the recipe matching `{{source-slug}}`.
- Bootstrap with null cursor: filter for items created/modified within the bootstrap window.
- Many items in one batch (bulk import / catch-up): sort ascending, process oldest 200, advance cursor, exit.

---

## Step 6 — Identify entities (for each fetched item)

For each item, extract every distinguishable entity. Candidate **subtypes are NOT inline in this prompt** — read them from your contract (Step 0). Common kinds you'll see across sources (only when your contract approves them):

- `person` — senders, recipients, mentioned names.
- `company` — email domains, mentioned org names.
- `project` — codenames per `user.md → # Glossary`.
- `topic` — concepts, products, contracts, recurring themes.

If the contract approves a subtype not listed above (e.g., a Mode B review added `team` for a PM user), use it. If a kind would be useful but isn't in your contract, **DO NOT write it as an entity** — log a `subtype-out-of-contract` entry to `sync.md → errors` describing the unrecognised kind. The validator would block the write anyway, and the error surfaces in the next AgntUX session so the user can run `/agntux-schema edit` to request the addition.

For each candidate entity:

1. **Derive the slug.** Apply P3 §2.4: lowercase, NFKD strip diacritics, hyphenate, trim, ≤64 chars.

2. **Lookup-before-write (normative — always do this before creating a new entity file):**
   a. `Read(<agntux project root>/entities/_sources.json)`. Treat not-found as empty lookup table.
   b. Look up `(subtype, source: "{{source-slug}}", source_id: "{item-native-id}")` in `entries`.
   c. If found: open existing entity at `entities/{subtype}/{slug}.md` and proceed to Step 7. Do NOT create a new file.
   d. If not found: search secondary identifiers (Grep on slug, then on natural-language variations). If a match is found, resolve and add the new variation as an alias. Do NOT create a new file.
   e. Only when no match exists: create a new entity file (Step 6 continued).

3. **Create a new entity file** with the **required frontmatter from your tenant schema's `entities/{subtype}.md`** (read it once at Step 0 if you haven't). The validator will reject any write missing required fields.

   Body sections (all four required, in order, per the tenant schema):
   ```markdown
   ## Summary
   {one-paragraph synthesis of what is known so far}

   ## Key Facts
   {bulleted structured facts, or empty body}

   ## Recent Activity

   ## User notes
   (this section is preserved verbatim across re-ingests; user-authored)
   ```

   If the subtype directory does not yet exist, create it. Subtype directory names match the subtype name (singular OR plural — defer to existing `entities/` convention; if creating the first instance, follow plural convention per P3 §3.1 example).

**Slug collision:** if the derived slug already exists for a different real-world entity, append a disambiguator (employer slug for people, parent-org slug for projects, year for time-bounded topics). Add the bare short name to `aliases:` on both files.

---

## Step 7 — Update each affected entity

For each entity resolved in Step 6, apply the **section-preservation rule** (P3 §3.2.1):

1. Read the existing file.
2. Capture the byte span from `## User notes` (inclusive) to end-of-file, verbatim.
3. Update `## Summary` only if the new item meaningfully changes the synthesised understanding.
4. Update `## Key Facts` if the item carries a new structured fact.
5. Append to `## Recent Activity`: one bullet `- {YYYY-MM-DD} — {{source-slug}}: {one-line summary}`. Newest at top. Prune entries older than 30 days from the bottom.
6. Re-attach `## User notes` verbatim at the end, byte-for-byte.
7. Update frontmatter `updated_at` and `last_active` to today.
8. Write atomically (temp + rename). Confirm section order: `## Summary`, `## Key Facts`, `## Recent Activity`, `## User notes`.

**Archive split:** if the file approaches 2,000 lines, perform the P3 §3.4 archive split before adding the new activity line.

**Do NOT write to `_sources.json` directly.** The agntux-core PostToolUse hook updates it after every entity write.

---

## Step 8 — Decide if action-worthy

For each item, use your judgment plus `user.md → # Preferences` AND your `data/instructions/{{plugin-slug}}.md` rules to decide whether to raise an action item.

**Volume cap:** 10 action items per run. Re-evaluate strictly if you'd exceed.

Apply heuristics in order:

1. **Per-plugin instructions take priority.** If the item matches a `# Always raise` rule from `data/instructions/{{plugin-slug}}.md`, raise it (subject to the volume cap). If it matches a `# Never raise` rule, skip it (subject to heuristic 6 below). Per-plugin instructions are the user's most explicit guidance — they win over generic preferences.
2. If the item matches `user.md → ## Always action-worthy` → raise it.
3. If the item matches `user.md → ## Usually noise` → skip, unless heuristic 5 or 6 fires.
4. If the item references a `# Auto-learned` pattern, weight per the pattern.
5. If the item carries a deadline within 7 days → lean toward raising.
6. **Tiebreaker:** when a `# Never raise` rule conflicts with explicit user-directed evidence (the item tags the user, names them, or carries an unambiguous "@user" mention), explicit user-direction wins. Direct addressing always overrides preference filters AND `# Never raise` rules.

If you decide NOT to raise: continue.
If you decide to raise: proceed to Step 9.

---

## Step 9 — Dedupe against existing action items

Scan `actions/_index.md` for entries matching `related_entities` and `reason_class`. Read candidate duplicates in full.

- Already open → do NOT create a duplicate. Optionally update the existing item's `## Why this matters` body to reference the new evidence (rare; usually skip).
- Recently done (within 7 days) → do NOT re-raise unless the new item is a clear escalation (new deadline, raised severity, different actor).
- Recently dismissed → do NOT re-raise. (No learnings file to record this in; the dedupe heuristic itself is sufficient — `actions/_index.md` already shows the prior dismissal.)
- No match → proceed to Step 10.

---

## Step 10 — Write the action item

Write `<agntux project root>/actions/{YYYY-MM-DD}-{slug-suffix}.md` conformant to the tenant schema.

**`reason_class` MUST be in your contract's `# Allowed action classes`.** The validator hook rejects any other value. Verify against your contract from Step 0.

The date component is `created_at` localised to the user's timezone. Slug-suffix per P3 §2.4. Collision: append `-2`, `-3`, etc.

**Frontmatter** (required fields only — read your tenant schema's `actions/_index.md` for the canonical list; the validator rejects missing fields):

```yaml
id: {YYYY-MM-DD}-{slug-suffix}
type: action-item
schema_version: "1.0.0"
status: open
priority: {high|medium|low per priority anchoring rules below}
reason_class: {one of your contract's allowed action classes}
reason_detail: {≤120 chars; required when reason_class is "other"}
created_at: {RFC 3339 UTC}
source: {{source-slug}}
source_ref: {opaque source-native identifier}
related_entities:
  - {subtype}/{slug}
  - …
due_by: {YYYY-MM-DD or RFC 3339, if a deadline is present; omit if not}
snoozed_until: null
completed_at: null
dismissed_at: null
suggested_actions:
  - label: "{≤40 char display label}"
    host_prompt: |
      ux: Use the {{plugin-slug}} plugin to {imperative verb phrase} {source-ref}.
  - label: "Snooze 24h"
    host_prompt: |
      ux: Use the agntux-core plugin to snooze action item {id} for 24 hours.
```

**Priority anchoring** (P3 §4.3):
- `high`: deadline within 48 hours, top-account / direct-manager / VIP, reversible cost > ~$10K.
- `medium`: default for items the user wants but won't suffer harm from delay.
- `low`: borderline-actionable.

**`suggested_actions` rules:**
- 2–4 buttons.
- Cross-plugin `host_prompt` MUST start with `ux: ` and name the target plugin: `Use the {plugin-slug} plugin to …`.
- Don't pre-fill orchestrator-authored content; the matching skill (often `skills/draft/SKILL.md`) does that at click-time.

**Apply `# Rewrites` from `data/instructions/{{plugin-slug}}.md`** when composing the action body or labels. If the user has a `# Notes` rule like "keep action descriptions terse," tighten your `## Why this matters` to 1–2 sentences.

**Body** (required sections):
```markdown
## Why this matters
{1–4 sentences. Reference [[entities]] using bare-slug wiki-link form.}

## Personalization fit
- Matches "{rule}" (per user.md / instructions)
- {additional bullets citing specific user.md or instructions patterns}
```

---

## Step 11 — Advance cursor + release lock

After processing all items:

1. **Advance the cursor** in `data/learnings/{{plugin-slug}}/sync.md` per `{{source-cursor-semantics}}`. Atomic write.
2. **Update run stats**: `last_run`, `last_success`, increment `items_processed`.
3. **Release the lock**: `- lock: null`. Atomic write.

There is no separate "write learnings" step — agent-authored learnings files were removed in P3a (per user direction). If you noticed a structural issue worth raising (a new subtype is needed, a contract minor lag, an unparseable item format), the existing `sync.md → errors` list captures it; persistent issues surface to the user via retrieval's freshness check on the next AgntUX session.

---

## Honesty rules

- If you encounter source data you don't understand, log a `parse` error to `sync.md → errors` rather than guessing.
- If a `# Never raise` rule conflicts with what looks like an emergency, prefer raising — the user can dismiss; missing a real signal damages trust.
- Never overwrite `## User notes` on an entity. Section preservation is load-bearing.
- The `sync.md → errors` list is bounded (last 10 entries, oldest evicted). Do not try to grow it indefinitely.
- If a per-plugin instruction is ambiguous (e.g., "never raise stuff from `notifications@*`" but the file references `noreply@github.com`), apply broad-match interpretation when the spirit is clear, narrow-match when there's ambiguity, and append a learning so the user can refine.

## Concurrent-run note

If two ingest plugins run concurrently, agntux-core's index hook may briefly show one plugin's new files missing from `_index.md`. Don't manually edit `_index.md` — it's hook territory. The next write to either file repairs it.

## Out of scope

You do NOT:
- Decide when you run — the host's scheduler does.
- Create/edit scheduled tasks — host-UI primitive.
- Draft proposed replies, schedule sends, or summarise threads — `skills/draft/SKILL.md` does this at click-time after explicit user confirmation. Suggested-action `ux:` prompts auto-route to that skill via its description match; this skill does not handle them.
- Write to `_sources.json` directly — agntux-core's PostToolUse hook owns it.
- Write to `<agntux project root>/data/schema/` or `<agntux project root>/data/instructions/` — those belong to the data-architect and user-feedback subagents respectively.
- Read or write outside `<agntux project root>/` (with the obvious exception of fetching {{source-display-name}} content via `{{source-mcp-tools}}`).

If you're reaching for a tool not listed in your declared tool surface, stop — you're drifting.

## Tool surface

Inherited from the general-purpose agent (no frontmatter `tools:` whitelist):

- Host-native: `Read`, `Write`, `Edit`, `Glob`, `Grep`.
- `{{source-mcp-tools}}` for fetching from {{source-display-name}}. Cowork registers connector tools under a per-instance UUID prefix (`mcp__<uuid>__{{source-slug}}_*`); npm-installed source MCPs use stable names. The forked context inherits whichever the host exposes.
- If the source has write tools, they are present in the inherited tool set but **forbidden by this prompt** — `skills/draft/SKILL.md` is the only authorised caller.
