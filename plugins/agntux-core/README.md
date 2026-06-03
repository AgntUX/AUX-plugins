# AgntUX Core

Your AgntUX home base. Run `/agntux onboard` to get set up, then `/agntux triage` to see your action items.

## What it does

AgntUX Core is the first plugin you install — every other AgntUX plugin builds on it.
It keeps your information organized, shows your action items in priority order, and keeps
everything current as your other plugins bring in new updates.

## Install

Install AgntUX Core first, before any other AgntUX plugin — everything else builds on it.

After installing, run `/agntux onboard` once. That sets up your profile and gets
everything ready. Run it again any time you install a new plugin.

## Quickstart

AgntUX gives you one command — `/agntux` — that handles everything. Type what you
want after it, and AgntUX figures out the rest. The two you'll use most are at the
top of this list:

| Command | What it does |
|---|---|
| `/agntux onboard` | **Do this first** — and again any time you install a new plugin. Sets up your profile and gets everything ready. |
| `/agntux triage` | **Your everyday command.** Shows your action-items list, sorted by what matters most. You'll use this all day. |
| `/agntux profile` | Edit your preferences, glossary, and sources. |
| `/agntux teach {plugin}` | Set a rule for one plugin (e.g. "never flag email from X"). |
| `/agntux schema` | Review or adjust how your information is organized. |
| `/agntux sync {plugin}` | Check a connected plugin for new updates now (e.g. `/agntux sync slack`). |
| `/agntux ask "..."` | Ask a question about your information, or update an item. |

You can also just talk to AgntUX. Saying "show my action items", "what's hot",
or "what should I look at" opens the same list as `/agntux triage` — but the
command is the reliable way to get there, so reach for it first.

## Recommended scheduled tasks

| Task | Prompt body | Cadence |
|---|---|---|
| Daily action-item digest | `/agntux triage-digest` | Daily 08:00 |
| Daily feedback review | `/agntux feedback-review` | Daily 16:00 |

## The triage view

Running `/agntux triage` (or saying "what's hot" / "show my action items")
opens your action-items list. It shows your open items in priority order,
with buttons to snooze, dismiss, or mark each one done — plus per-item
shortcuts that hand off to the right plugin (reply in Slack, draft in
Gmail, and so on).

For a scheduled morning summary, the `/agntux triage-digest` task sends a
plain-text version of the same list — handy when no one's at the screen.

The old entity-browser screen was retired in 5.0.0. To look something up,
just ask — e.g. `/agntux ask "tell me about Avery Rivera"`.

## Configuration

Run `/agntux profile` to set your preferences — these control how AgntUX
prioritizes your action items and tailors things to you.

## Limitations

- Needs at least one other AgntUX plugin (like Slack or Gmail) to bring in real data.
- Your information stays on your own machine — there's no cloud sync yet.

## Hooks

This plugin ships a small set of plugin-specific hooks under `hooks/` for
schema and index validation:

- `hooks/validate-schema.mjs` — PreToolUse, blocks malformed entity writes.
- `hooks/validate-contract.mjs` — PreToolUse, blocks contract violations.
- `hooks/maintain-index.mjs` — PostToolUse, keeps the entity index current.

## License

Apache License 2.0. See the `LICENSE` and `NOTICE` files at the repo
root for full terms.

## Support

- Bugs and proposals: https://github.com/AgntUX/AUX-plugins/issues
- License: see the LICENSE file at the repo root.
