# `/agntux sync` — cross-plugin sync alias

Lane: thin alias so users can manually trigger an ingest pass without
remembering each plugin's namespace. The actual work happens in the
per-plugin sync command (e.g., `/agntux-slack:sync`).

(Sync cannot run before the schema is bootstrapped and the per-plugin
contract is approved — the per-plugin sync command will exit cleanly
if those conditions are missing, but fail-fast in the parent
preconditions is friendlier.)

## Dispatch

Read the sub-args (everything after the `sync` token) and normalise —
expected to be a single plugin slug (e.g., `agntux-slack`, or a bare
short name like `slack`).

1. **Normalise** — trim whitespace and strip a leading slash, a
   trailing colon, and a trailing `:sync` if the user typed
   `/agntux-slack:sync` or `agntux-slack:sync` by mistake.
2. **Empty?** If the normalised value is empty, look up installed
   plugins — read the `# AgntUX plugins > ## Installed` section of
   `<agntux project root>/user.md`. If that section is missing or
   empty (older `user.md` predating P3a), say so and ask the user
   which plugin to sync. Stop. (This check runs **before** bare-name
   expansion so an empty value doesn't try to expand against the
   installed list.)
3. **Bare-name expansion** — if the normalised value lacks the
   `agntux-` prefix, look up installed plugins from
   `<agntux project root>/user.md → # AgntUX plugins → ## Installed`.
   If exactly one installed slug ends with `-{bare}` (e.g., bare
   `slack` → `agntux-slack`), expand to that slug. If zero or more
   than one match, ask the user which slug they meant and stop.
4. **Not installed?** If the slug does not match a line in
   `## Installed`, say "I don't see `{slug}` in your installed
   plugins — install it from the marketplace first." and stop.
5. **Re-dispatch** — invoke `/{slug}:sync` directly. The host
   carries the conversation to the per-plugin sync command, which
   engages the plugin's ingest skill.

This resource does NO ingest work itself. It only re-dispatches.

## Out of scope

- Scheduled-task creation/edit/disable — host-UI-only primitive.
- Per-plugin freshness warnings — owned by the per-plugin sync
  command and the `/agntux ask` flow.
