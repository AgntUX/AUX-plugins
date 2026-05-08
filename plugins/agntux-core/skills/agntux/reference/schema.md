# `/agntux schema` — schema review and edit

Lane: explicit user-driven schema review or edit, AND schema bootstrap
when `../../_preconditions.md` routes here for Mode A. Pending plugin
install reviews and queued schema requests also flow through here per
the dispatch table below.

## Always check first

1. **Project root**: resolve the AgntUX project root — the nearest
   ancestor of the host's cwd named `agntux` (case-insensitive),
   falling back to `~/agntux`. If neither exists, exit: "I can't find
   an AgntUX project root. Run `/agntux onboard` and the personalization
   flow will help you set one up."
2. **user.md exists**: confirm `<root>/user.md` exists. If not, exit:
   "I need your profile before I can design your schema. Run
   `/agntux onboard` first." Do NOT bootstrap a schema without
   `user.md`.

**Plain-language framing rule (universal):** the user must NEVER hear
internal-vocabulary terms (`subtype`, `action_class`, `schema_version`,
etc.). Read `${CLAUDE_PLUGIN_ROOT}/data/schema-design-rubric.md` §1a
once at run-start for the full banned-words list and replacements.
Translate freely between internal canonical vocabulary (files) and
user-facing plain language.

## Authority discipline

Write authority is **only** `<root>/data/schema/` and the two state
files (`schema-warnings.md`, `schema-requests.md`). Everything else is
read-only context or off-limits.

| Path | Read? | Write? |
|---|---|---|
| `<root>/user.md` | Yes | No |
| `<root>/data/schema/schema.md` | Yes | Yes |
| `<root>/data/schema/entities/_index.md` | Yes | Yes |
| `<root>/data/schema/entities/{subtype}.md` | Yes | Yes |
| `<root>/data/schema/actions/_index.md` | Yes | Yes |
| `<root>/data/schema/contracts/{plugin-slug}.md` | Yes | Yes |
| `<root>/data/schema/schema.lock.json` | Yes | Yes |
| `<root>/data/schema-warnings.md` | Yes | Yes (append-only) |
| `<root>/data/schema-requests.md` | Yes | Yes (delete on consume) |
| `<root>/data/instructions/{plugin-slug}.md` | Yes | No |
| `<root>/data/learnings/`, `<root>/entities/`, `<root>/actions/` | No | No |

If you ever find yourself about to Edit a path outside
`<root>/data/schema/` or `<root>/data/schema-{warnings,requests}.md`,
stop — you are drifting.

## Detect mode

Read `<root>/data/schema/schema.md` (existence),
`<root>/user.md → ## Installed` plugin list, Glob
`<root>/data/schema/contracts/*.md`, and
`<root>/data/schema-requests.md`.

| Condition | Mode |
|---|---|
| `schema.md` does not exist AND `user.md` does | **A** — bootstrap |
| At least one `## Installed` plugin lacks a `contracts/{slug}.md` | **B** — plugin install review (one per missing, in listed order) |
| `schema-requests.md` exists and non-empty | **C** — escalation-driven edit |
| User said `/agntux schema edit` or passed a free-text edit ask | **C** — user-driven edit |
| User said `/agntux schema review {slug}` and contract exists | **C-bis** — re-review existing contract |
| `schema.md` exists and none of the above | "Schema is stable. Want to add something I'm tracking, change a name, or look at a specific plugin?" Wait. |

Multiple modes: run B → C in order. Announce to the user before
starting. If genuinely ambiguous, ask one short clarifying question.

---

## Mode A: Bootstrap

`schema.md` does not exist. `user.md` is populated. Synthesise a
baseline schema fitted to the user's discovery answers; walk them
through approve/edit in plain language; write the approved schema.

**Sparse-discovery handling.** If `discovery_summary` carries the
`(needs-clarification)` suffix, skip custom design: write a minimal
baseline (`person`, `topic`, plus any subtype strongly implied by
`# Sources`), tell the user in plain language to come back after data
is flowing, and skip Stages 2 and 4's user-facing presentation.

### Stage 1 — Read context

Read `<root>/user.md` end-to-end: `discovery_summary`, `# Discovery`
(the load-bearing section — re-read it), `# Identity`, `# People`,
`# Day-to-Day`, `# Aspirations`, `# Goals`, `# Preferences`,
`# Glossary`, `# Sources`, and `## Installed`. For each installed
plugin, read its `marketplace/listing.yaml → proposed_schema` block so
the baseline leaves room for Mode B. For `## Planned` plugins: size
only, no preemptive ownership grants.

Read `${CLAUDE_PLUGIN_ROOT}/data/schema-design-rubric.md` end-to-end.
This is your design playbook. There is no role-preset library (removed
4.0.0); the old presets live in rubric §4 as illustrative patterns
only.

Web search is allowed when it helps with domain-appropriate entity
naming.

### Stage 2 — Propose in plain language

Present the proposed entity categories in the user's vocabulary:

> Based on what you told me, here's what I'm planning to keep track of for you:
>
> - **{plain-language category}** — {one-line description}.
>
> Sound right? Anything missing, or anything that doesn't quite fit?

Translate user responses silently to formal changes. "I don't really
track customers" → drop it, say "Got it, I'll skip customers." "Call
them clients" → rename + alias, say "Switched to clients." Stay lean —
six categories is the usual ceiling.

### Stage 3 — Field shapes (internal only)

Do NOT surface field lists to the user. For each accepted subtype,
write required + optional frontmatter per rubric §2. Universal required
fields (P3 §3.1): `id`, `type: entity`, `schema_version`, `subtype`,
`aliases`, `sources`, `created_at`, `updated_at`, `last_active`,
`deleted_upstream`. Optional fields by entity shape: people-like add
`email`, `role`, `employer_slug`; org-like add `domain`, `industry`;
initiative-like add `status`, `started_at`; event-like add `start_at`,
`end_at`; document-like add `kind`, `source_url`; topic-like add
`parent_topic`; asset-like add `kind`, `value`, `acquired_at`.

### Stage 4 — Action classes (plain language)

> When something needs your attention, there are a few common reasons — a
> deadline, someone waiting on you, a heads-up, a risk, an opportunity. Are
> there other reasons that come up for you, given what you've got going on?

Map user answers to existing classes silently. Add a new class only if
it genuinely doesn't fit an existing one. Never say "action class" to
the user.

### Stage 5 — Write the schema (atomically, in order)

1. `<root>/data/schema/entities/_index.md` — approved subtypes + owning plugin (none on bootstrap).
2. `<root>/data/schema/entities/{subtype}.md` — one per subtype; sections: `## Description`, `## Required frontmatter`, `## Optional frontmatter`, `## Body sections`, `## Aliases`.
3. `<root>/data/schema/actions/_index.md` — action_class enum, `## Priority`, `## reason_class` notes (see `## reason_class discipline` below).
4. `<root>/data/schema/schema.md` — master contract; `schema_version: "1.0.0"`.
5. `<root>/data/schema/schema.lock.json` — regenerate (see `## Lock-file invariants`).

Save after each write. Confirm in plain language:

> Got it. I'll keep track of: {list}. Whenever new sources connect, I'll fit
> what they bring in to this picture, and I'll let you know when something
> doesn't quite fit so we can adjust.

---

## Mode B: Plugin install review

An `## Installed` plugin has no approved contract yet. Read its schema
proposal, decide approve/rename/merge/refuse per entry, write the
approved contract.

### Stage 1 — Read context

Read `user.md`, `schema.md`, all `entities/*.md`, all existing
`contracts/*.md`. Resolve the plugin's
`marketplace/listing.yaml → proposed_schema` via
`mcp__plugins__list_plugins` (ToolSearch first); fall back to
`${CLAUDE_PLUGIN_ROOT}/../{plugin-slug}/marketplace/listing.yaml`. If
the file is missing or unparseable, exit: "I can't read the schema
proposal for `{plugin-slug}` — its `marketplace/listing.yaml` is
missing or malformed." Also read
`data/instructions/{plugin-slug}.md` if it exists (valuable design
signal from the per-plugin onboarding interview).

### Stage 2 — Decide per entry (internal)

For each `entity_subtypes` and `action_classes` entry in the proposal:
**Approve** if already in `_index.md` and the proposed
required_frontmatter is a subset or additive. **Rename** if it overlaps
an existing name; record proposed name as alias. **Merge** if
near-duplicate; pick existing canonical. **Refuse** if genuinely out
of scope.

### Stage 3 — Present in plain language

> {plugin-name} wants to start tracking some things for you. Here's what I'm
> planning:
>
> - {plain-language description of each decision}
>
> Anything to override?

Accept user overrides without argument. The user is the final
authority.

### Stage 4 — Migration warning check

For every decision that adds a NEW required frontmatter field on an
existing subtype, append to `<root>/data/schema-warnings.md`:

```
{ISO 8601 UTC} | mode-B | {plugin-slug} | required field `{field}` added to `{subtype}` — existing entities may lack it.
```

Always emit — assume existing entities will lack it. Do NOT scan
`entities/` instance files (no read authority). Don't backfill.

### Stage 5 — Write the approved contract

```markdown
---
type: plugin-contract
plugin: {plugin-slug}
schema_version: "1.0.0"
approved_at: {ISO 8601 UTC}
approved_by: agntux-schema
source_id_format: {from proposed_schema, if present}
cursor_semantics: {from proposed_schema, if present}
---

# Allowed entity subtypes
- {subtype}{ — alias of {canonical} | (refused: {reason})}

# Allowed action classes
- {class}

# Notes
- {one-line summary of install review and any merges/renames}
```

Contract MUST NOT contain `## reason_class additions` — see
`## reason_class discipline` below. After writing: update any modified
`entities/{subtype}.md` files; regenerate `schema.lock.json` with a
**full sweep** of all `contracts/*.md` (not just the new one) — see
`## Lock-file invariants`. The sweep catches late-installed plugins
missing from the lock (2026-05-07 agntux-gmail incident).

Confirm: "{plugin-name} is wired up. {one-line plain summary of what'll happen.}"

---

## Mode C: Schema edit

Sources: `/agntux schema edit` (interactive), entries in
`schema-requests.md` (from `/agntux teach` Mode C, `/agntux profile`
Mode D, `/agntux ask` failure-to-bind, pattern-feedback graduation,
per-plugin onboarding), or `/agntux schema review {slug}` re-review.

Read `user.md`, `schema.md`, all subtype files, all action_class files,
all contracts, `schema-requests.md` if non-empty (oldest-first),
`data/instructions/{slug}.md` if request scopes to a plugin.

**Identify the change.** Direct: ask "What would you like me to keep
track of differently?" Escalation: surface the queue entry in plain
language; ask for confirmation.

**State before applying:**

> Schema changes are additive — I never break or remove things you're already
> using. If you ask for something that would break existing data, I'll record
> it as a warning and propose a way to add it without breaking anything.

Apply the correct edit type:

| User ask | Edit type | Migration warning? |
|---|---|---|
| Rename a category | Update `_index.md`, rename file, add old name to `aliases:`, update all contracts | Only if required field involved |
| Add a new optional field | Edit `## Optional frontmatter` | No |
| Add a new required field | Edit `## Required frontmatter`; tell user "older ones won't have it until I do a sweep" | Yes |
| Rename a field | Edit, record old name as deprecated alias | If required |
| Add a new action type | Edit `actions/_index.md` + affected contracts; sub-categorisations go in `reason_detail` prefixes, not new classes | No |
| Remove an action type | Only if no contract grants it; otherwise refuse, propose additive workaround | N/A |
| Remove a required field | Refuse; offer to make it optional instead | N/A |

Migration warning format: same as Mode B Stage 4 (`mode-C` label).

After writing, regenerate `schema.lock.json`. Confirm: "Done. {one-line
summary of what changed.}" If consumed from `schema-requests.md`,
remove that entry from the queue (Edit the file).

---

## reason_class discipline (universal)

Applies to every Mode A `actions/_index.md` write, every Mode B
contract, and every Mode C edit touching `actions/_index.md` or a
contract.

- **`reason_class` is the closed action_class enum** from
  `schema.lock.json → action_classes`. Anything not in that enum is
  rejected at action-item write time by `hooks/validate-schema.mjs`.
- **New action classes** proposed via
  `proposed_schema → action_classes` must land in the contract's
  `## Action_class usage` section AND in
  `schema.lock.json → action_classes` when you regenerate the lock.
- **Sub-categorisation** (e.g. "track which DMs are from execs") goes
  in `reason_detail` (free-text), not a new `reason_class`. Document
  recommended prefix conventions (e.g. `[dm]`, `[mention]`) in the
  contract under `## reason_detail prefixes`.
- **A contract MUST NOT contain `## reason_class additions`** listing
  sub-tags by action_class. Reframe any such block from the plugin's
  `proposed_schema` as `## reason_detail prefixes` before writing.

Correct framing in a contract:

```markdown
## reason_class enum
`reason_class` carries the closed action_class enum from `schema.lock.json`.

## reason_detail prefixes
Tags at the start of `reason_detail`, e.g. `reason_detail: "[dm] John asked for sign-off"`.
Not valid `reason_class` values.
- `[dm]` — direct DM to the user.
- `[mention]` — @-mention in a channel.
```

---

## Lock-file invariants

`<root>/data/schema/schema.lock.json` shape (P3a §6.1):

```json
{
  "schema_version": "1.0.0",
  "generated_at": "{ISO 8601 UTC}",
  "entity_subtypes": ["person", "company", "project", "topic"],
  "action_classes": ["deadline", "response-needed", "knowledge-update", "risk", "opportunity", "other"],
  "plugin_contracts": {
    "{plugin-slug}": {
      "schema_version": "1.0.0",
      "allowed_subtypes": [],
      "allowed_action_classes": [],
      "approved_at": "{ISO 8601 UTC}",
      "source_id_format": "{format}"
    }
  },
  "checksum": "sha256:{hex}"
}
```

Regenerate after every schema write. Checksum = sha256 of concatenated
bytes of `schema.md` + every `entities/*.md` + `actions/_index.md` +
every `contracts/*.md`, sorted by path. If sha256 is unavailable, write
`"checksum": "sha256:UNCOMPUTED"` and the validator falls back to
per-file content checks. Atomic write: write `.tmp`, fsync, rename — a
partial lock blocks every entity write.

Mode B sweep rule: always regenerate by walking ALL `contracts/*.md`
whose frontmatter has `status: approved`, not just the plugin being
installed. Existing contracts with a matching lock entry are no-ops
(compare field-by-field; rewrite only when a value differs).

---

## State files

**`<root>/data/schema-warnings.md`** — append-only. One line per
warning: `{ISO 8601 UTC} | {mode: A|B|C} | {plugin-slug or -} | {description}`.
Do not remove prior lines.

**`<root>/data/schema-requests.md`** — read-and-consume queue. Each
entry: `{ISO 8601 UTC} | {plugin-slug} | request: {summary} | source: "{description}"`.
After acting, Edit the file to remove the consumed line.

---

## Be honest

- Refuse a proposed subtype or action_class that doesn't fit; explain
  in plain language.
- If a Mode B change would break existing entities, surface the warning
  to the user before writing — don't bury it in `schema-warnings.md`
  only.
- If you can't tell whether a proposed entity is a rename or genuinely
  new, ask one short plain-language question.
- An honest "I'm not sure how this fits — tell me more" beats a
  speculative merge.
- Plain-language framing is not optional. If you're about to type
  `subtype` to the user, stop and rephrase.

---

## Out of scope

- Per-plugin instructions (always/never rules) → `/agntux teach {slug}`.
- Cross-workflow preferences (action-worthy, noise, glossary) →
  `/agntux profile`.
- Pending plugin install reviews and queued schema-requests triggered
  automatically via `../../_preconditions.md` checks 3–4 are handled
  before this resource's body runs — do NOT re-route them here.
