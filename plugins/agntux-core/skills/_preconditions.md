# AgntUX entry-point preconditions (shared)

Every named `agntux-core:*` skill that the user can directly invoke
references this block. Lifted verbatim from the legacy `/ux`
orchestrator. **This file is not a skill** — leading underscore keeps
it out of the slash-command surface. Each entry-point skill points
here from its body.

The flow is: emit the trial banner first (always), then run the
ordered preconditions; stop at the first one that diverts.

## Contents

- [A. Trial-status banner](#a-trial-status-banner-always-emit-before-any-other-output)
- [B. Preconditions (run in order)](#b-preconditions-run-in-order)
  - [Check 0 — Project root](#0-project-root)
  - [Check 0.5 — Plugin reconciliation](#05-plugin-reconciliation-auto-correct-never-blocks)
  - [Check 1 — `user.md` exists and parses](#1-agntux-project-rootusermd-exists-and-parses)
  - [Check 2 — Schema bootstrapped](#2-schema-bootstrapped)
  - [Check 3 — Installed plugins lacking a contract](#3-installed-plugins-lacking-a-contract)
  - [Check 4 — Schema-requests queue](#4-schema-requests-queue)

---

## B. Preconditions (run in order)

Stop at the first check that diverts; announce the redirect to the
user in one short sentence and chain into the named skill that owns
the prerequisite.

### 0. Project root

Walk the resolution per the `_resolve-root.md` link declared at the
top of your invoking SKILL.md (cwd basename → ancestor → `~/agntux`
→ offer onboarding). On a successful resolution, continue with the
next check using the resolved root for every `<agntux project root>`
reference below. On step 4 routing to `/agntux onboard`, or on the
user declining, exit Check 0 (no further checks fire — onboarding
owns the rest of the flow, or the user opted out).

### 0.5. Plugin reconciliation (auto-correct, never blocks)

**Skip this check if `user.md` does not exist or fails to parse** — check 1
below handles that case by routing to `/agntux onboard`, which has its own
reconciliation pass in Mode A-bis. Trying to read `## Installed` from a
missing or malformed file would log noise without recovering anything.

Run `ToolSearch({query: "select:mcp__plugins__list_plugins", max_results: 1})`.
If the tool resolves, call it to get the host's installed plugin list and compare
against `<agntux project root>/user.md → # AgntUX plugins → ## Installed`.

- **Auto-update `## Installed`** to add any installed plugins missing from the
  list. This is a mechanical sync — `## Installed` is no longer the source of
  truth. The `data/instructions/{slug}.md` files and the host's plugin list
  jointly are. Update frontmatter `updated_at`. Capture the SET of slugs
  added in this pass — call it `newly_added_slugs` — you'll use it below.
- **Sync to `~/.agntux/installed-plugins.json`** — call
  `agntux_core_sync_installed_plugins` with the COMPLETE host-enumerated
  list (every plugin returned by `mcp__plugins__list_plugins`, NOT the
  diff added to `## Installed`). Pass an empty `plugins: []` when the
  host returns zero — the tool REPLACES, never patches. The agntux-teams
  daemon watches this file and POSTs the snapshot to AgntUX so the
  remote MCP connector surfaces each installed plugin's view-tools.
  Non-blocking AND silent on failure: if the tool fails (e.g.
  agntux-core's MCP server isn't connected), emit no chat line, no
  apology, no follow-up — the user never sees this tool fire.
- **Nudge the user to refresh the AgntUX connector** — when
  `newly_added_slugs` is non-empty, emit one line at the top of the
  response:
  `🔌 New plugin(s) added to AgntUX ({slug-list}). To see their tools in Claude Desktop, open Settings → Connectors, find the AgntUX connector, click its three-dot menu, and choose "Refresh tools list".`
  Why: the remote MCP server snapshots the user's installed-plugin set
  at session-init time, so a freshly-added plugin's view-tools won't
  appear on the live connector until the user reconnects. Without this
  nudge users assume the plugin "doesn't work" and re-run onboarding.
  Emit this BEFORE the `/agntux onboard` nudge below. Skip when
  `newly_added_slugs` is empty — re-running a command shouldn't spam
  the user with a refresh prompt every time.
- **Detect newly-onboarded plugins** — installed plugins that lack a
  `data/instructions/{slug}.md` file (or whose file has `status: draft`).
- **If running `/agntux onboard`**: hand the newly-detected set to Mode A-bis
  via Set 2 (installed-without-instructions). The skill's normal flow walks
  per-plugin onboarding for each.
- **If running any other `/agntux-*` command** AND there is at least one
  newly-detected plugin: emit one nudge line at the top of the response —
  `📦 N new AgntUX plugin(s) detected ({slug-list}). Run /agntux onboard to walk through them.` —
  and continue with the user's actual request. Do NOT block.

If `mcp__plugins__list_plugins` does not resolve, log nothing and continue.
Stage 4.6 / Mode A-bis falls back to the union-of-three-sets computation
described in the `agntux-onboard` skill (Mode A-bis section).

### 1. `<agntux project root>/user.md` exists and parses

If the file does not exist, the user has never onboarded.
Acknowledge their original ask in one sentence ("I see you asked
about X — but I need to set up your profile first."), then chain
into `/agntux onboard`. After onboarding completes, re-run
these preconditions before returning to the user's original ask —
a brand-new `user.md` will trip the schema-bootstrap check below
on the next pass.

If the file exists but its frontmatter or required body sections
(`# Identity`, `# Preferences`, `# Glossary`) cannot be parsed,
say "Your `user.md` looks malformed. Run `/agntux profile` to
fix it." and stop. (Do NOT attempt to repair it yourself — the
`agntux-profile` skill owns it.)

### 2. Schema bootstrapped

If `<agntux project root>/data/schema/schema.md` does not exist AND `user.md`
exists, the schema has never been bootstrapped. Announce the
preemption ("Before I get to that — your tenant schema isn't set up
yet.") and route to **`/agntux schema`** (it owns Mode A — bootstrap
from `user.md`). After it completes, return to the original ask.

### 3. Installed plugins lacking a contract

For each slug under `<agntux project root>/user.md → # AgntUX plugins → ## Installed`,
check whether `<agntux project root>/data/schema/contracts/{slug}.md` exists.
If at least one is missing, the plugin has been installed but is not yet
authorised. The route depends on whether per-plugin onboarding (the
`agntux-onboard`-owned interview that writes `data/instructions/`) has
already run for that plugin:

For each missing-contract plugin (in `## Installed` order):

- **Case A — `data/instructions/{plugin-slug}.md` does not exist OR
  has frontmatter `status: draft`**: per-plugin onboarding never
  finished. Route to **`/agntux onboard`** (Mode A-bis —
  new-plugins walkthrough). Mode A-bis runs the per-plugin
  onboarding interview, which itself routes to `/agntux schema`
  (Mode B) at the right moment. Do NOT route to `/agntux schema`
  directly here — that would bypass the user-facing interview and
  write a contract without the user's instructions context.
- **Case B — `data/instructions/{plugin-slug}.md` exists with
  `status: final`**: onboarding finished but `/agntux schema`
  Mode B was interrupted. Route to **`/agntux schema`** (Mode B)
  directly. The skill reads the proposal directly from the
  plugin's `marketplace/listing.yaml → proposed_schema` block
  alongside the finalized instructions and writes the approved
  contract.

After all missing-contract plugins are processed, return to the
original ask.

This precondition is NOT invoked from `/agntux onboard` (which
explicitly opts out — see that skill's own pre-checks). Every other
entry-point skill DOES run this check.

### 4. Schema-requests queue

If `<agntux project root>/data/schema-requests.md` exists AND has at least one
non-blank queue line, route to **`/agntux schema`** (Mode C —
schema edit driven by `/agntux teach` escalation). The skill
consumes one entry per invocation. After it completes, return
to the original ask.

### Order

If multiple checks fire simultaneously, run them in this order:
2 → 3 → 4. State the order to the user before starting. Check 1
(missing or malformed `user.md`) preempts everything else. Check 0.5
(plugin reconciliation) is non-blocking — it auto-corrects state and may
emit one informational nudge line, but never short-circuits the flow.
