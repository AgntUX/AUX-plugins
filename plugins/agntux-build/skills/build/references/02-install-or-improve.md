# Stage 2 — install-or-improve branch (when an existing plugin matched)

This stage only runs when stage 1's marketplace search returned an
exact slug match. If stage 1 came back with no match, the user
confirmed they want to build a new plugin — skip stage 2 entirely
and continue to [`03-connect-source.md`](03-connect-source.md).

The two paths from here:

## Path A — install the existing plugin

The user didn't know the plugin existed and wants to install it. The
work is mechanical:

1. Load the host's plugin install tool via `ToolSearch`. Typical name
   is `mcp__plugins__install_plugin` but resolve at runtime — the
   shape varies between hosts. The tool typically takes a plugin slug
   and either marketplace name or source URL.
2. Dispatch with the matched plugin slug (e.g., `agntux-linear`) and
   the marketplace name (`agntux` for the AUX-plugins marketplace).
3. Confirm the install succeeded — the host either returns a success
   payload or surfaces an error envelope.

### What to say

Before:
> Installing `agntux-{slug}`. Should be quick — it'll show up under
> Personal Plugins once it's done.

After (success):
> {Name}, that's installed.
>
> Two things to do next:
> 1. Run `/agntux onboard` to walk through how
>    {connector-display-name} fits into your AgntUX setup.
> 2. The plugin syncs every {cadence-from-plugin-json}, but you can
>    trigger a sync any time with `/agntux-{slug} sync`.
>
> Thanks for the nudge — saved us a duplicate.

After (error):
> Looks like the install didn't go through —
> {error-message-or-summary}. Want me to try again, or do you want to
> open the issues page?

Don't try to brute-force the install. If it fails twice, redirect to
issues:
`https://github.com/AgntUX/AUX-plugins/issues?q=label%3Aagntux-{slug}`.

After a successful install, **stop**. Don't continue to stage 3 — the
flow is done for this user.

## Path B — switch to update mode (the existing plugin has issues)

The user has used the plugin and hit something. Time to walk the same
build-test-iterate loop but framed as a fix. Load
[`update-mode.md`](update-mode.md), capture the user's specific
complaint, then continue with stage 3 onward.

Update-mode skips the schema design (the existing plugin has one)
and skips the manifest scaffolding (existing). Stage 12 reframes
submission as "submit a fix" rather than "submit a new plugin."

## Path C (rare) — install AND update in sequence

Sometimes the user didn't have the plugin installed AND has prior
hands-on experience from another machine that surfaced an issue. In
that case:

1. Install the existing plugin (path A).
2. Once installed, ask: *"You mentioned you'd hit an issue with this
   before — want to walk through fixing it now, or come back later?"*
3. If yes → switch to update mode (path B). If later → close the flow
   politely.

## Saved state at end of stage 2

Update `sessions/{session-id}.json`:

```json
{
  ...,
  "marketplace_match_action": "installed | switched_to_update | declined"
}
```

If `installed` and the user closed the flow, write a final
`session_status: "complete"` and stop.
