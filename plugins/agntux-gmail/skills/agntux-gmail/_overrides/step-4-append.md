**Onboarding mode — heads-up, no per-thread cap.** A bootstrap run typically fires synchronously during `/agntux onboard`. The bootstrap processes every thread surfaced by discovery within the window — there is no per-thread cap. Coverage matters more than wall-clock here.

Before starting per-thread polling on a bootstrap run (`last_success: null AND cursor` has zero thread-shaped entries), print **one** user-facing chat message after Step 5b discovery completes:

> "I'm about to fetch ~{bootstrap_window_days} days of activity across ~{N} threads from your Gmail inbox. This may take a few minutes. If you'd rather not wait, hit the stop button and tell me what you'd prefer (e.g. only the last 24 hours, or just specific senders)."

Substitute `{bootstrap_window_days}` and `{N}` (count of distinct thread-shaped keys produced by Step 5b). Print exactly once per run. If the user interrupts mid-bootstrap, the cancelled run leaves unprocessed threads with `null` cursors; the next scheduled run picks them up. Log a `gmail-bootstrap-interrupted` entry to `sync.md → errors` listing the deferred thread count.
