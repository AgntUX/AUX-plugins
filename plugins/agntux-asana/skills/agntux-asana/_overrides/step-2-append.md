When reading `data/learnings/agntux-asana/sync.md`, also capture:
- `user_gid` — the authenticated user's Asana GID. Null on first run;
  Step 5a resolves and Step 11 persists it.
- `workspace_gid` — the primary Asana workspace GID. Null on first run;
  Step 5a resolves and Step 11 persists it.

Both are cursor-lifetime fields: once non-null, treat them as stable
for deep-link construction and `modified_since` filtering without
re-calling the identity endpoint.
