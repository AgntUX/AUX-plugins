**iMessage triage tier (from Step 5d classification)**

Each sender thread carries a `triage_tier` determined during Step 5d.
Apply it here to decide action-worthiness and entity creation:

- **`needs-you`** → action-worthy. Raise a `response-needed` action item.
  Include the assigned tier in the action's frontmatter so the triage
  surface can rank and group: `priority: high`. Create or refresh a
  `person` entity for the sender (Step 6 lookup-before-write applies).

- **`personal-fyi`** → not action-worthy for `response-needed`. Create or
  refresh a `person` entity for the sender (named contacts belong in the
  knowledge store). Record the thread in the entity but do NOT raise an
  action item. If the message contains information that updates an existing
  entity (a person, project, or topic already in the knowledge store), apply
  a `knowledge-update` class action only if new, non-redundant information
  is present; otherwise skip.

- **`promotional-automated`** → suppress entirely. Do NOT raise any action
  item, do NOT create or update a `person` entity, and do NOT write to
  `_sources.json` for this sender. Log the sender and message count to
  `sync.md → items_processed` for run accounting only. Senders classified
  as `promotional-automated` are unresolved strangers or confirmed
  promotional/automated sources; creating contact records for them pollutes
  the knowledge store.

**Entity creation summary by tier:**

| Tier | Create/refresh person entity? | Raise action item? |
|---|---|---|
| `needs-you` | Yes | Yes (`response-needed`) |
| `personal-fyi` | Yes | No (knowledge-update only if new info) |
| `promotional-automated` | **No** | No |

**Tier annotation on action items.** When writing a `needs-you` action
(Step 10), include the following in the action frontmatter:

```yaml
priority: high
triage_tier: needs-you
```

This allows the view tool to group by tier and sort `needs-you` items
above `personal-fyi` items (which carry no action file).
