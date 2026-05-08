**Slack-specific sync.md fields** (all three are source-derived identity / cursor-lifetime state — capture once, reuse forever, persist via Step 11):

- `discovery_ts` — newest message ts surfaced by any of the three discovery search queries (used as the `after:` filter on the next run).
- `workspace_subdomain` — the tenant subdomain used to construct Slack deep links offline (e.g. `"oatfi"` for `oatfi.slack.com`); captured the first time any Slack MCP read tool returns a `Permalink:` field — see Step 5b. When still `null`, the `Open in Slack` suggested action is omitted from action items written this run. Workspace renames are out of band; clear the file manually to force re-derivation.
- `user_id` — the resolved Slack user id (e.g. `U030YKZBSDC`); captured by Step 5a's `slack_read_user_profile()` call. Persisting it here means subsequent runs skip the Step 5a call entirely. Workspace-stable; never overwrite once non-null.

**Cursor map shape.** The `cursor` field is a unified single-line JSON map with two key shapes (channel-shaped `<channel_id>` and thread-shaped `<channel_id>#<thread_ts>`). Parse with `JSON.parse(cursor)`, serialise with `JSON.stringify(map)`. Full layer reference and worked example: apply the cursor reference shape (`reference/cursor.md`).
