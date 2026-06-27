# {{source-display-name}} frontmatter metadata — Step 10 reference

Wholesale override for the canonical `compose-payload.md`.

Documents the frontmatter metadata fields written into every
{{source-display-name}} action file at Step 10. The view tool calls
`extractFrontmatterMetadata(actionFile)` at click time — returning the raw
parsed YAML object from the action file's `---` frontmatter block — to
pre-fill each iframe without re-fetching {{source-display-name}} content.

**No `## Compose payload` body section is used for the comment and update
views.** Those fields live in the action file's top-level frontmatter YAML.
The create view is the exception: `draft_body` is the markdown body below the
frontmatter block (see Create-page view section).

---

## YAML quoting reminder

Any string scalar in the frontmatter block containing `: ` (colon-space), a
leading `-`, or starting with `{` / `[` MUST be wrapped in double quotes —
otherwise the YAML parser interprets it as a key/value pair, list item, or
flow collection and the field is silently dropped, leaving the iframe blank.
Example: `page_title: "My page: overview"` not `page_title: My page: overview`.

---

## Comment-reply view (`agntux_notion_comment_view`)

For actions whose `suggested_actions` opens the comment-reply view (action
class `notion:comment:reply` or similar). Write these fields into the action
file's frontmatter block at Step 10:

```yaml
page_id: "{Notion page UUID — the source page this comment thread belongs to}"
discussion_id: "{Notion comment-thread UUID from notion-get-comments; distinct from page_id}"
page_url: "{canonical https://notion.so/... URL of the Notion page}"
page_title: "{display title of the Notion page as returned by notion-fetch}"
comment_thread: |
  {quoted comment thread — include parent comment and up to 3 most-recent
   replies, each prefixed with the author name and relative timestamp;
   ≤600 chars total; truncate with '…' if longer}
draft_body: |
  {agent-composed reply in the user's voice, ≤4000 chars; grounded in the
   comment thread content and the user's personalization signals from user.md}
personalization_signals: |
  {≤4 bullet lines, ≤120 chars each; cite the user.md / instructions rule
   that shaped tone or content — e.g. "Tone: direct — per user.md §2"}
```

### Field rules — comment view

**`page_id`**: Notion page UUID (not a URL). Passed verbatim to the Notion
Connector's comment-creation call to target the correct page. Falls back to
`action_id` at render time only as a last resort when absent.

**`discussion_id`**: UUID of the comment thread from `notion-get-comments`.
Required for the connector to post into the correct discussion thread.

**`page_url`**: Full `https://notion.so/...` URL shown in the iframe header
as a deep-link back to the source page.

**`page_title`**: Display name of the Notion page shown in the iframe header
so the user can confirm context at a glance.

**`comment_thread`**: Quoted thread for context. Include the original comment
and the most-recent replies (up to 3), each attributed to the author. Truncate
to 600 chars with `…`. The iframe renders this as the read-only context pane.

**`draft_body`**: Agent-composed reply text. Write in first person as the user;
ground it in the actual comment thread content. The iframe pre-seeds the
editable reply field with this value.

**`personalization_signals`**: Tone/style reminders. Up to 4 bullets; cite the
rule from user.md that motivated each one.

---

## Update-page view (`agntux_notion_update_view`)

For actions whose `suggested_actions` opens the page-property editor view
(action class `notion:page:update-properties` or similar). Write these fields
into the action file's frontmatter block at Step 10:

```yaml
page_id: "{Notion page UUID — the target of notion-update-page}"
page_url: "{canonical https://notion.so/... URL of the Notion page}"
page_title: "{display title of the Notion page}"
current_properties: |
  {JSON or YAML snapshot of the page's current property values as returned by
   notion-fetch; include property name, type, and current value for every
   editable property; ≤2000 chars; truncate with '…' if longer}
editable_properties: |
  {JSON or YAML list of the properties the user is most likely to want to
   change (status, due date, assignee, priority, etc.); drawn from
   current_properties; include the agent's suggested new value where one can
   be inferred from context; ≤2000 chars}
```

### Field rules — update view

**`page_id`**: Notion page UUID. Passed verbatim to `notion-update-page` as
the target page identifier.

**`page_url`**: Full `https://notion.so/...` URL. Shown in the iframe header.

**`page_title`**: Display name of the page. Shown in the iframe header as
context for the property edit.

**`current_properties`**: Snapshot of all property values from `notion-fetch`.
The iframe renders this as the before-state context; the handler reads this to
populate the property fields. Serialize as compact JSON or YAML; truncate at
2000 chars.

**`editable_properties`**: Filtered subset focusing on the properties most
likely to need updating. Include the agent-suggested new value for each where
one can be inferred (e.g., status "In Progress" → "Done"). This drives the
pre-populated edit form in the iframe.

---

## Create-page view (`agntux_notion_create_view`)

For actions whose `suggested_actions` opens the new-page creator view (action
class `notion:page:create` or similar). Write these fields into the action
file's frontmatter block at Step 10, and write the pre-composed page content
as the markdown body below the frontmatter block:

```yaml
parent_options: |
  {JSON array of candidate parent locations — pages or databases — where the
   new page could be created; each entry must include id, title, and type
   (page | database); ≤2000 chars; populated from notion-query-data-sources
   or recent notion-search results scoped to likely parent contexts}
draft_title: "{agent-composed page title, ≤80 chars, in the user's voice; specific and actionable}"
```

The `draft_body` for this view is read from the **markdown body below the
frontmatter block** (not a frontmatter field). Write the pre-composed page
content as the action file body immediately after the closing `---` delimiter:

```
---
... frontmatter fields above ...
---

{agent-composed Notion page content, ≤4000 chars, in the user's voice;
 use markdown headings, bullets, and paragraphs as the content warrants;
 grounded in the source context that triggered the create action}
```

### Field rules — create view

**`parent_options`**: JSON array of candidate parent locations. The iframe
renders this as a picker so the user can choose where to create the page.
Derive from `notion-query-data-sources` for the authoritative database list;
supplement with recently-accessed pages from `notion-search`. Each entry
shape: `{"id": "...", "title": "...", "type": "page"|"database"}`.

**`draft_title`**: Agent-composed title for the new page. Specific and
actionable (≤80 chars). The iframe pre-seeds the title field. Falls back to
reading `fm.title` if `draft_title` is absent, so either key works but
`draft_title` is preferred for clarity.

**Body (`draft_body`)**: Markdown content below the frontmatter `---`. The
create-view handler reads `parseFrontmatter(text).body`, making the body the
pre-composed page content. Author it as clean markdown; the iframe pre-seeds
the body editor with this text.

---

## Cross-source-merged actions

When Step 9 finds a sibling open action to merge into, the frontmatter fields
above are written under the same keys — no namespace change is needed for
frontmatter-delivered payloads. Merge dedup writes only the fields for the
view the merged action opens.
