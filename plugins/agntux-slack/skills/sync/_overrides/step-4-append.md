**Slack-ingest default is 7 days** for `bootstrap_window_days` (overrides the P3 §6.1 default of 30 because Slack volume is much higher than email/notes; documented in `# Notes` of your contract). Valid range 1–365 unchanged.

**Onboarding mode — heads-up, no cap.** A bootstrap run typically fires synchronously during `/agntux-onboard` (personalization State A wrap-up auto-fires `/agntux-sync agntux-slack` with the user present). The bootstrap **processes every channel surfaced by discovery** — there is no per-channel cap. Coverage matters more than wall-clock here; the user already knows this is a one-time post-setup run.

Before starting per-channel polling on a bootstrap run (`last_success: null AND cursor` has zero channel-shaped entries), print **one** user-facing chat message after Step 5b discovery completes, with the real numbers:

> "I'm about to fetch ~{bootstrap_window_days} days of activity across ~{N} channels and DMs from your Slack workspace. This may take a few minutes. If you'd rather not wait, hit the stop button and tell me what you'd prefer (e.g. only the last 24 hours, or just specific channels)."

Substitute `{bootstrap_window_days}` with the resolved window value and `{N}` with the count of distinct channel-shaped keys produced by Step 5b. Print exactly once per run and only when this is a true bootstrap (do not print on incremental runs).

If the user interrupts mid-bootstrap, the cancelled run leaves unprocessed channels with `null` cursors in the map; the next scheduled run picks them up automatically. When the run is cancelled or exits early with channels still at `null`, log a `slack-bootstrap-interrupted` entry to `sync.md → errors` listing the deferred channel count so the next AgntUX session can surface the gap.
