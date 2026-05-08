**Slack-specific cursor advance details.** When walking the cursor map at the end of a successful run:

- **Channel-shaped keys** (`<channel_id>`, no `#`): set to the newest parent-message ts processed in that channel.
- **Thread-shaped keys** (`<channel_id>#<thread_ts>`): set to the newest reply ts processed in that thread. Evict thread-shaped entries with no activity for ≥30 days.
- **Channel-shaped entries are never evicted.**
- **Discovery low-water-mark.** Advance `discovery_ts` to the newest message ts surfaced by any of the three discovery search queries.

**Eviction log requirement.** For every key you evict, append a `slack-thread-evicted` entry to `sync.md → errors` naming the dropped key. The agntux-core `validate-cursor.mjs` PreToolUse hook rejects writes that silently drop a prior cursor key without an `evicted`-marked error line.

**Persist `workspace_subdomain`** if it was captured for the first time during Step 5b. Once non-null, this value is workspace-stable and never overwritten on subsequent runs.

**Persist `user_id`** if it was captured for the first time during Step 5a (cold-start). Once non-null, the value is workspace-stable; subsequent runs skip the `slack_read_user_profile()` call entirely (per Step 5a). Both `user_id` and `workspace_subdomain` are written as part of the single Step 11 sync.md write, not separate edits.

For the per-layer reference table, apply the cursor reference shape (`reference/cursor.md`).
