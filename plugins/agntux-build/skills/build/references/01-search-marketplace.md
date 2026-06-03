# Stage 1 — greet, capture intent, search the marketplace

Stage 1 has three parts that run in one chat turn each:

1. **Greet.** Use the contributor's name from stage 0 if this is a
   re-entry; first sentence is a thank-you for choosing to contribute.
2. **Capture intent.** Ask the one question that frames everything
   downstream — what system the user wants AgntUX to support.
3. **Search the marketplace** for an existing plugin and branch on
   the result.

Building a duplicate is the worst possible outcome — it splits
maintenance, confuses users, and wastes the contributor's time. The
search-first rule is non-negotiable; never skip it even if the user
seems certain no plugin exists.

## Greet

If stage 0 just ran (first session in this AgntUX root), the user
just typed `I agree` — open with appreciation:

> Thanks, {name}. Now we get to build something.

If stage 0 was already done (re-entry on a later day), open with
recognition that they're back:

> Welcome back, {name}.

Don't pad the greet — one sentence is enough.

## Capture intent

Ask exactly one question:

> What system would you like AgntUX to support?

Parse the answer for:

- **The display name** ("Linear", "Notion", "a new project tracker
  called Height").
- **The slug you'll use.** Lowercase, hyphen-separated, must match
  `/^[a-z][a-z0-9-]*[a-z0-9]$/`. Drop spaces ("Apple Mail" →
  `apple-mail`), version digits in the middle ("Things 3" →
  `things3`), branding noise.

Confirm both before searching:

> Got it — `agntux-{slug}` for {display-name}. Sound right?

If they correct you, accept the correction; never argue about
spelling or naming.

## Search the marketplace

Call the agntux-build MCP tool — it reads `marketplace/index.json`
*past* the GitHub CDN and matches server-side, so the full index
never floods this conversation:

```
agntux_marketplace_lookup({
  slug: "{slug}",                        // bare or agntux- prefixed
  query: "{display-name} {aliases}",     // e.g. "GitHub gh", "Google Calendar gcal"
  agntux_root: "{stage-0 agntux root}"   // enables the offline cache
})
```

Always pass `query` — the user's system name plus any obvious
aliases (`gh`, `gcal`, `mail`) — so the soft keyword/tagline match
can fire. If the tool isn't loaded yet, resolve it first with
`ToolSearch({query: "select:agntux_marketplace_lookup", max_results: 1})`.

Why a tool and not `WebFetch`: the old path fetched
`raw.githubusercontent.com`, which is CDN-cached and once served
**2-week-stale** content — it missed a freshly-landed plugin and
offered to build a duplicate. The tool fetches via the GitHub
Contents API (current-commit bytes, no edge cache) with cache-busted
fallbacks.

The AgntUX marketplace is the *only* registry that matters here.
Do NOT reach for `mcp__plugins__list_plugins`, `ToolSearch query:
"list plugins"`, or any other host-level plugin discovery — those
enumerate the host's full plugin universe (all marketplaces) and
will produce false negatives ("nothing called agntux-jira") that
are really false positives ("the host knows about non-AgntUX
Atlassian plugins, but they don't ingest into AgntUX").

## How to read the result

- **`exact_match` non-null** → **branch 1** (the plugin already
  exists). Use its `slug` / `tagline` / `description` for the
  install card.
- **`exact_match` null but `keyword_matches` non-empty** → **branch
  2** (a related plugin might be the same system). Use
  `keyword_matches[].slug` + `.tagline`. The `slugs` array is the
  full name list — scan it for an alias the soft match missed (e.g.
  the bare slug `mail` → `agntux-gmail`, `gcal` →
  `agntux-google-calendar`; these are illustrative, scan the actual
  `slugs`) before concluding it's a true miss. If `slugs_truncated`
  is `true` the list was capped, so a soft miss is NOT authoritative —
  treat it like branch 0 and confirm with the user.
- **both empty** → **branch 3** (nothing exists; build new).
- **`ok: false`** → the marketplace could NOT be verified (network
  down, no cache). This is UNKNOWN, never "nothing exists" — see
  **branch 0**.

**If `stale` is `true`** (`source: "cache-stale"`): the live
marketplace was unreachable, so this answer is a cached snapshot from
`fetched_at` and may be out of date. An `exact_match` is still
trustworthy (a plugin that existed still exists), but before a
**branch 3** new build, tell the user you're reading a cached snapshot
and confirm — a very recently-added plugin might not be in it.

## Three branches (plus the can't-verify guard)

### 0. Couldn't verify (`ok: false`)

The tool could not reach the marketplace and had no cached copy. Do
**not** assume the plugin is new. Tell the user plainly and confirm
before proceeding:

> I couldn't reach the AgntUX marketplace just now to check whether a
> {connector-display-name} plugin already exists. You can check
> directly at
> https://github.com/AgntUX/AUX-plugins/tree/main/plugins — want me
> to go ahead and build a new one, or hold off until we can confirm?

Only continue to a new build (branch 3) on an explicit go-ahead.

### 1. Exact slug match

The plugin already exists. Tell the user, then ask:

> Looks like there's already a plugin for {connector-display-name} —
> `agntux-{slug}`. Have you tried it before?

Branch on the answer:

- **"No, I didn't know."** Offer to install:

  > Want me to install it for you? It'll handle
  > {connector-display-name} the same way agntux-slack handles Slack
  > — every {polling-cadence-from-listing-yaml}, with the same triage
  > flow.

  If yes, render the install card for the matched AgntUX plugin via
  Cowork's plugin-suggest tool. **The pluginId comes from the tool's
  `exact_match`** — never from a host-wide plugin search, which would
  broaden the scope past AgntUX:

  1. Resolve the tool:
     `ToolSearch({query: "select:mcp__plugins__suggest_plugin_install", max_results: 1})`.
  2. On resolve, call with the matched entry only:
     ```
     mcp__plugins__suggest_plugin_install({
       plugins: [{
         pluginId: "agntux-{slug}",
         pluginName: "agntux-{slug}",
         description: "{exact_match.tagline}"
       }],
       contextLabel: "Already in the AgntUX marketplace"
     })
     ```
  3. On no resolve (non-Cowork host), fall back to the prior prose
     path: tell the user the slug to install manually and link
     `https://github.com/AgntUX/AUX-plugins/tree/main/plugins/agntux-{slug}`.

  After the install card renders (or the manual path is acknowledged),
  thank the user and stop:

  > That's installed. Run `/agntux onboard` if you haven't already —
  > that'll walk through how {connector-display-name} fits into your
  > AgntUX setup. Thanks for the nudge — you saved us building a
  > duplicate.

- **"Yes, but it's not working / I want to fix it."** Switch to
  update mode. Load
  [`update-mode.md`](update-mode.md) and continue from
  there. The same stages 3–10 apply, but stage 12 frames the
  submission as a fix to the existing plugin.

### 2. Keyword / soft match

A related plugin exists but doesn't exactly match. Tell the user
what we found and ask whether it's the same system:

> I see there's `agntux-{related-slug}` in the marketplace —
> {keyword_matches[].tagline}. Is that the same system you mean, or
> is {user's-input} something different?

If same: treat as branch 1. If different: continue to branch 3.

### 3. No match

> Nothing in the marketplace yet. Let's build a new plugin for
> {connector-display-name}.

Confirm the slug you'll use (lowercase, hyphen-separated, must start
with `agntux-`):

> The plugin will be named `agntux-{slug}`. Sound right?

Once confirmed, load
[`02-install-or-improve.md`](02-install-or-improve.md) (which is
mostly a no-op when there's nothing to install — it's the
update-mode entry point).

## Slug rules (reference — already enforced during intent capture above)

- Always prefixed `agntux-`.
- Source slug after the prefix: lowercase, alphanumeric, hyphens.
- Length: 3–30 chars after the prefix.
- Must match `/^[a-z][a-z0-9-]*[a-z0-9]$/`.
- Don't use the connector's marketing name verbatim if it has spaces
  or punctuation. `Things 3` → `things3`. `Bear Notes` → `bear`.
  `Apple Mail` → `apple-mail`.

## What you save before moving on

To `<agntux project root>/.agntux-build/sessions/{session-id}.json`:

```json
{
  "connector_display_name": "Linear",
  "connector_slug": "linear",
  "plugin_slug": "agntux-linear",
  "mode": "create"
}
```

(Or `"mode": "update"` if branch 1 sent us into update mode.)

## What you say to advance

> Great — let's get connected to {connector-display-name} so we can
> see what it can do.

Then load [`03-connect-source.md`](03-connect-source.md).
