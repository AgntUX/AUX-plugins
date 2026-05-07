---
plugin: agntux-gmail
generated_at: <RFC 3339 — fill at copy time>
status: draft
---

# Always raise

# Senders or queries that should always surface, even if filtered by
# category or denylist. Each rule is one bullet. Examples (uncomment
# to enable):
#
# - from:digest@vercel.com   # weekly digest the user actually reads
# - from:rlai@portageinvest.com
# - from:board@ — any sender whose local part starts with "board@"

# Never raise

# Approval-required automations and other senders the user explicitly
# does NOT want surfaced. Bare email or substring match.
#
# - from:notifications@github.com
# - from:billing@   — any "billing@" address

# Rewrites

# Transformations applied to drafted_body in the compose payload.
# Each rule is one bullet starting with the trigger and ending with
# the substitution. Examples:
#
# - Always sign off as "John"
# - Replace "ASAP" with an explicit time
# - Use Markdown lists rather than prose for follow-ups

# Notes

# Soft preferences the agent honors when composing actions and drafts.
# Each line is one preference.
#
# - Keep action descriptions terse (1–2 sentences).
# - Skip-sent-awaiting-reply   # opts out of Stage 2 of the discovery sweep

# Sender denylist

# Auto-learned from noise-filtering decisions. Appended to Step 5b's
# discovery query as `-from:<entry>` exclusions. Capped at 30 entries
# per the SKILL's "Bounded lists in state files" rule. Manually-curated
# entries (no metadata suffix) are NEVER auto-evicted.
#
# Lines auto-added by the sync skill:
#   - mongodb-atlas-alerts@mongodb.com  <!-- added: YYYY-MM-DD, dropped: 12 -->
# Lines added by the user manually (no metadata):
#   - spammer@example.com
