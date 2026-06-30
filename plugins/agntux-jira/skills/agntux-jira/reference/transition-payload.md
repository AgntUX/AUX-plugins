# Transition payload schema — Step 10 reference (agntux-jira)

Companion to `reference/sync.md` Step 10. Describes the `## Transition payload`
body section the ingest skill writes to every action item that carries a
`Transition issue` suggested action. The `agntux_jira_transition_view` view tool
reads this section at click time via `parseTransitionPayloadYaml()`.

Source: `data/instructions/transition.md` — `## Transition payload`.

---

## Conditional body section: `## Transition payload`

REQUIRED for every action item whose `suggested_actions` list contains a
`Transition issue` entry (handler: `transition`). Available transitions MUST be
fetched at ingest time via Step 5g (`getTransitionsForJiraIssue`) and embedded
in full — the iframe renders the complete list as a radio group.

### structuredContent keys

| Key | Type | Source |
|---|---|---|
| `cloud_id` | string | Atlassian Cloud instance ID — from `data/learnings/agntux-jira/sync.md → cursor.cloudIds[0]` |
| `issue_key` | string | Issue key (e.g. `OFM-412`) — `issue.key` |
| `issue_url` | string | `{atlassian_site_url}/browse/{issue_key}` |
| `issue_title` | string | `issue.fields.summary` |
| `current_state` | string | `issue.fields.status.name` at ingest time |
| `available_transitions` | object[] | Each: `{id: string, name: string}` — from `getTransitionsForJiraIssue` |
| `suggested_transition_id` | string | The transition id the ingest agent recommends |
| `optional_comment` | string or null | Pre-composed one-sentence transition rationale, or `null` |
| `personalization_signals` | string[] | ≤4 bullets, ≤120 chars each |
| `generated_at` | string | RFC 3339 timestamp of this ingest run |

These names match the `TransitionViewStructuredContent` interface in
`view-tool/src/agntux-jira-view.ts`.

### On-disk shape

```markdown
## Transition payload

​```yaml
cloud_id: "<atlassian cloud id>"
issue_key: "<PROJECT-NNN>"
issue_url: "https://<site>.atlassian.net/browse/<PROJECT-NNN>"
issue_title: "<summary>"
current_state: "<status name>"
available_transitions:
  - id: "<transition id>"
    name: "<transition name>"
  - id: "<transition id>"
    name: "<transition name>"
suggested_transition_id: "<id of recommended transition>"
optional_comment: null
personalization_signals:
  - "<≤120 chars; reason for the suggested transition>"
generated_at: "<RFC 3339 of this run>"
​```
```

YAML quoting reminder: any string scalar containing `: ` MUST be wrapped in
double quotes. Transition IDs from Jira are short numeric strings (e.g. `"31"`);
quote them to prevent YAML integer coercion. `issue_title` may contain colons;
wrap it.

`optional_comment` is `null` by default. Populate with one sentence only when
the transition requires context (e.g. `"Resolving — PR #42 was merged and
deployed to staging."`). Never populate with a question.

---

## Send envelope target

Connector: Atlassian Connector
Tool: `mcp__claude_ai_Atlassian__transitionJiraIssue`

The envelope is assembled by `buildTransitionEnvelope()` in
`view-tool/src/apps/transition/lib/build-envelope.ts`.

Args derived from the form at Send time:

- `cloudId`: from `structuredContent.cloud_id`
- `issueIdOrKey`: from `structuredContent.issue_key`
- `transition.id`: the transition id the user selected in the picker (may differ
  from `suggested_transition_id` if they override)
- `update.comment` (optional): the value of `optional_comment` if non-empty;
  omitted from the envelope entirely when blank

The `suggested_transition_id` is a pre-selection hint, not a lock. The picker
must show ALL entries in `available_transitions`. Discard emits no envelope; a
local banner confirms the issue status is unchanged.
