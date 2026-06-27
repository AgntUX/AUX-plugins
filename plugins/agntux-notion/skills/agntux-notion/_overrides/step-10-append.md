
### Step 10.1c — Notion frontmatter metadata

This plugin uses three view tools that each read fields directly from the
action file's frontmatter via `extractFrontmatterMetadata`. Write the
matching frontmatter fields for every action that opens a Notion view — full
field definitions in the compose-payload reference shape.

**Comment-reply view** (action opens `agntux_notion_comment_view`):
Write into frontmatter: `page_id`, `discussion_id`, `page_url`, `page_title`
(Notion page display title), `comment_thread` (quoted thread ≤600 chars, in
the user's voice), `draft_body` (agent-composed reply ≤4000 chars),
`personalization_signals` (≤4 bullets citing user.md rules).

**Update-page view** (action opens `agntux_notion_update_view`):
Write into frontmatter: `page_id`, `page_url`, `page_title`, `current_properties`
(JSON/YAML snapshot from notion-fetch ≤2000 chars), `editable_properties`
(filtered subset with agent-suggested new values ≤2000 chars).

**Create-page view** (action opens `agntux_notion_create_view`):
Write into frontmatter: `parent_options` (JSON array of candidate parent
locations with id/title/type ≤2000 chars), `draft_title` (agent-composed
page title ≤80 chars). Write the pre-composed page body as the **markdown
body below the frontmatter block** (not a frontmatter field) — the handler
reads it as `draft_body` via `parseFrontmatter(text).body`.
