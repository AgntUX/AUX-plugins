---
type: schema-actions
schema_version: "1.2.0"
updated_at: {{generated_at}}
---

# Action item contract

Action items are stored at `<agntux project root>/actions/{YYYY-MM-DD}-{slug-suffix}.md` and indexed in `<agntux project root>/actions/_index.md`. The validator (`hooks/validate-schema.mjs`) checks every action write against this contract.

## Schema_version history

- **`1.0.0`** — initial.
- **`1.1.0`** — `entity_refs[]` promoted to required (P7).
- **`1.2.0`** — P9 migration: `snoozed_until` and `dismissed_at` on the action
  frontmatter are now **deprecated**. Personal triage state (snooze /
  dismiss) lives in `<agntux project root>/.agntux/triage-prefs.json`
  under the `triage_state` map (keyed by action-file path relative to the
  AgntUX root). Mark-done remains an action-file mutation (`status: done`
  plus `done_by_user_slug`, `done_by_user_id`, `done_at` for team-scoped
  rows). Existing files that still carry `snoozed_until` /
  `dismissed_at` in frontmatter remain readable during the transition;
  triage-prefs.json takes precedence when both signals exist. A
  scheduled maintenance pass after 90 days lifts any remaining
  frontmatter values into triage-prefs.json and drops the deprecated
  fields.

## Required frontmatter

- `id` — the filename without `.md`. Format: `{YYYY-MM-DD}-{slug-suffix}`.
- `type` — literal string `action-item`.
- `schema_version` — semver matching this contract.
- `status` — one of `open`, `snoozed`, `done`, `dismissed`.
- `priority` — one of `high`, `medium`, `low`.
- `reason_class` — one of the approved classes (see below).
- `created_at` — RFC 3339 UTC timestamp.
- `source` — slug of the ingest plugin that wrote this item (e.g., `notes`, `slack`, `gmail`).
- `source_ref` — opaque reference into the source system (file path, message ID, ticket key).
- `related_entities` — array of `{subtype}/{slug}` pointers (human-readable; survives renames as long as the slug is stable).
- `entity_refs` — array of `entity_id` values (hook-computed 16-hex-char identifiers) for the entities this action concerns. Promoted to required in `schema_version 1.1.0` (P7); supersedes `related_entities` for cross-namespace joins because `entity_id` is stable across the personal data root and every team data root that lifts the same entity.
- `suggested_actions` — 2–4 button definitions (P3 §4.5).

## Optional frontmatter

- `due_by` — date-only or RFC 3339 (when a deadline applies).
- `snoozed_until` — `deprecated: true` (1.2.0). Personal snooze state moved
  to `.agntux/triage-prefs.json` under `triage_state[path].snoozed_until`.
  Readers tolerate the field on legacy files but prefer the prefs value
  when both are present. New writers MUST NOT set this field.
- `completed_at` — RFC 3339 (set when `status: done`).
- `dismissed_at` — `deprecated: true` (1.2.0). Personal dismiss state moved
  to `.agntux/triage-prefs.json` under `triage_state[path].dismissed_at`.
  Readers tolerate the field on legacy files but prefer the prefs value
  when both are present. New writers MUST NOT set this field.
- `reason_detail` — required when `reason_class: other`; otherwise optional ≤120 chars.
- `team_id` — opaque team identifier (UUID) when this action belongs to a team scope. Present on items under `<root>/teams/{team-slug}/actions/`. Absent on personal items. Owned by `agntux-teams`.
- `team_slug` — denormalized human-friendly team slug (matches the parent directory name under `<root>/teams/`). Surfaced to the triage UI for fast filter rendering without resolving `team_id`. Absent on personal items.
- `source_team` — the team-slug whose data spawned this action, when different from `team_id`. Set by leader-view passes that synthesize cross-team items. Absent for actions authored from a single team's own data.
- `member_relevance_class` — slug naming the team-member onboarding category this item is tagged with (P3 v2). The triage UI renders a left-edge ribbon on rows where this is set. Absent on personal items.
- `relevance_classes` — array of relevance-class slugs the action belongs to. Used by the triage UI's strict-intersection filter against each member's onboarding-time picks (`teams/{slug}/data/members/{user-slug}.md`). Team-scope-only.
- `done_by_user_slug` — required-conditional when `status: done` on a team or leader-view scope. The user-slug of whoever marked it done. Absent on personal items (mark-done on a personal item only sets `status: done` + `completed_at`). Set by the `agntux_core_set_status` mutator.
- `done_by_user_id` — required-conditional when `status: done` on a team or leader-view scope. The canonical UUID identity for the marker. Pairs with `done_by_user_slug`.
- `done_at` — required-conditional when `status: done` on a team or leader-view scope. RFC 3339 timestamp. Distinct from `completed_at`: `completed_at` is the personal-item field; `done_at` is the team/leader-view-scope field. Both may be set on a team-scope action.

## `status` enum

- `open` — actively surfaced in the user's triage.
- `snoozed` — suppressed until `snoozed_until` (auto-woken by retrieval).
- `done` — user marked complete.
- `dismissed` — user marked irrelevant.

## `priority` enum

- `high` — deadline within 48 hours, top-account / direct-manager / VIP relationship, or reversible cost > ~$10K (per P3 §4.3).
- `medium` — default for items the user wants but won't suffer harm from delaying a few days.
- `low` — borderline-actionable.

## `reason_class` enum

`reason_class` is the closed action_class enum — every value lives in `schema.lock.json → action_classes`. The validator rejects anything else at action-item write time.

| Class | Description |
|---|---|
| `deadline` | Item has a hard date. |
| `response-needed` | Someone is waiting on the user. |
| `knowledge-update` | Informational signal worth surfacing. |
| `risk` | Something might go wrong if ignored. |
| `opportunity` | Something worth pursuing. |
| `other` | Escape hatch. Requires `reason_detail`. |

Plugins propose new action_classes via `proposed_schema → action_classes` in their `marketplace/listing.yaml`; once approved by the architect in Mode B, they are added to `schema.lock.json → action_classes` and become valid `reason_class` values. **Sub-categorisation that depends on context (per-message details) goes in `reason_detail`** — typically as a square-bracket prefix, e.g. `reason_detail: "[dm] John asked for sign-off"`. Per-plugin contracts MAY document recommended `reason_detail` prefix conventions under a `## reason_detail prefixes` section; those are authoring aids, not a closed enum.

### Worked example — contract framing

A plugin contract grants the canonical six action classes plus a custom `partner-signal` class. The correct shape:

```markdown
## Action_class usage

The plugin uses these action classes (matches `schema.lock.json → action_classes`):

- `response-needed` — DM to user, @-mention, decision request.
- `partner-signal` — happiness signal from a partner platform.
- `knowledge-update`, `risk`, `opportunity`, `deadline`, `other` — canonical six.

## reason_detail prefixes

These prefixes go at the start of `reason_detail` in square brackets, e.g. `reason_detail: "[dm] John asked for sign-off"`. They are NOT valid `reason_class` values.

For **`response-needed`**: `[dm]`, `[mention]`, `[decision-request]`.

For **`partner-signal`**: `[escalation]`, `[kudos]`, `[churn-risk]`.
```

A contract MUST NOT contain a `## reason_class additions` section listing per-action_class sub-tags — every such tag is a `reason_detail` prefix and `reason_class: dm` (or any other sub-tag) is rejected by the validator.

## Body sections (required, in this order)

- `## Why this matters` — 1–4 sentences. Reference `[[entities]]` using bare-slug wiki-links.
- `## Personalization fit` — bullets citing specific `user.md` patterns that justify this item at this priority.

## `suggested_actions` rules

- 2–4 buttons per item.
- Every cross-plugin `host_prompt` MUST start with `ux: ` and name the target plugin: `Use the {plugin-slug} plugin to …`.
- Ingest plugins do NOT pre-fill orchestrator-authored content (proposed reply, draft body, summary). agntux-core's retrieval subagent fills those slots at click-time (P3 §9).
