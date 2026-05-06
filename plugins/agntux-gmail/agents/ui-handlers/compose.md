---
name: compose
description: UI handler for the Gmail-reply compose card. Renders thread context, recipients (to/cc/bcc), subject, the agent-drafted reply body, the prior-conversation context disclosure, and the two-step Save-as-Gmail-draft envelope emitter. Engage when the host routes an "open the email composer for action {id}" prompt to compose_view.
tools: Read, mcp__agntux-gmail__agntux_gmail_compose_view

operational:
  catalogue_version: "1.0.0"
  verb_phrases:
    # The draft body, thread context, recipients, and reply_to_message_id are
    # pre-composed at ingest time and live in the action file's `## Compose
    # payload` body section (or `## Compose payload (gmail)` for cross-source-
    # merged actions). The host routes click-time prompts directly to
    # compose_view with only `{action_id}` — the view tool lifts the rest
    # from disk.
    - "open the email composer for action"
  view_tool: agntux_gmail_compose_view
  resource_uri: "ui://gmail-compose"
  structured_content_schema:
    - "action_id (string — kebab-case slug from filename, no .md suffix)"
    - "thread.thread_id (string — gmail opaque thread id)"
    - "thread.subject (string, ≤200 chars)"
    - "thread.parent_message_id (string)"
    - "thread.parent_author_real_name (string)"
    - "thread.parent_author_email (string)"
    - "thread.parent_excerpt (string, ≤300 chars)"
    - "thread.last_message_id (string)"
    - "thread.last_author_real_name (string)"
    - "thread.last_author_email (string)"
    - "thread.last_excerpt (string, ≤300 chars)"
    - "thread.total_messages (number)"
    - "thread.participants[] ({real_name, email}, ≤12 entries)"
    - "recipients.to (string[], ≤50 emails)"
    - "recipients.cc (string[], ≤50 emails)"
    - "recipients.bcc (string[], ≤50 emails)"
    - "reply_to_message_id (string — gmail message id we're replying to)"
    - "drafted_body (string, ≤4000 chars — agent-composed reply)"
    - "personalization_signals (string[], ≤4 × ≤120 chars)"
    - "email_context (string, ≤1000 chars — prior-conversation preamble)"
    - "gmail_thread_url (string | null — https://mail.google.com/...#inbox/<thread_id>)"
    - "user_email (string | null — derived from gmail_thread_url's authuser=)"
  follow_up_intents:
    # The Save button emits a two-step Gmail Connector envelope: call
    # create_draft, then post a clickable draft link in chat. Discard is a
    # pure local action — emits nothing.
    - "gmail-connector-create-draft-then-link"
  display_modes:
    - inline
  degraded_states:
    source_not_found:
      ui: no-render
      action: "Same handling as action_not_found. Surface 'Couldn't find that action item — it may have been resolved or removed.'"
    action_not_found:
      ui: no-render
      action: "Surface 'Couldn't find that action item — it may have been resolved or removed.'"
    action_already_handled:
      ui: no-render
      action: "Surface 'This action is no longer open — already done, dismissed, or snoozed.'"
    agntux_root_missing:
      ui: no-render
      action: "Surface 'Run /agntux-onboard to set up your AgntUX workspace.'"
    compose_payload_missing:
      ui: no-render
      action: "Surface 'This action has no pre-composed draft. Open it in Gmail to reply there.'"
    license_paused:
      ui: no-render
      action: "Surface 'Your trial is paused. Upgrade at app.agntux.ai/billing to keep AgntUX active.'"
  notes: |
    The Gmail MCP server has no send-email tool. The strongest write surface
    is `create_draft`. The iframe Save button does NOT actually send email —
    it creates a draft in Gmail Drafts and posts a clickable link. The user
    finishes the Send action from Gmail's own UI.

    Auto-resolution (Step 8.5 in skills/sync/SKILL.md) closes the action on
    the next sync run when it detects the user has actually sent the message
    in the gmail thread.
---

# Gmail compose UI handler

This handler is invoked at click time when the user clicks `Draft a reply` on
an action item. The host's description-based MCP tool routing matches the
prompt against `compose_view` directly — no skill round-trip — and the iframe
renders inline with the pre-composed draft already loaded.

## Operational flow

1. **Ingest time** (skills/sync/SKILL.md Step 10): the sync skill writes a
   `## Compose payload` body section to the action file containing the
   drafted reply body, recipients, subject, reply_to_message_id, thread
   context, personalization signals, and the gmail_thread_url. For
   cross-source-merged actions (the slack action grew a "Draft an email
   reply" button per Step 9's merge protocol), the section is namespaced as
   `## Compose payload (gmail)`.

2. **Click time**: the host receives `ux: Use the agntux-gmail plugin to
   open the email composer for action {id}.` and routes it to
   `agntux_gmail_compose_view`. The view tool reads the action file, lifts
   the namespaced (or bare) `## Compose payload` section, and returns
   structuredContent for the iframe.

3. **Render**: the React component fills in the to/cc/bcc/subject/body form,
   surfaces "Why this draft?" (personalization_signals) and "Prior
   conversations" (email_context) disclosures, and renders the
   "Save as Gmail draft & open" primary button + "Discard" secondary.

4. **Save click**: the component's `buildEnvelope()` constructs a two-step
   Gmail Connector envelope (`create_draft` followed by a clickable link
   to the resulting draft) and emits it via `sendFollowUpMessage()`. The
   host runs `create_draft`, captures the `draftId`, and posts the link
   back to chat. The user clicks the link, opens Gmail, reviews, hits Send.

5. **Auto-resolution**: on the next hourly sync (Step 8.5 of the sync
   skill), agntux-gmail detects the user's sent message in the thread and
   marks the action `done` with an `## Auto-resolved` body section.

## Error envelopes

Returned when the action file is missing, malformed, or the action is no
longer open:

- `action_not_found` — the action id doesn't resolve to a file under
  `<root>/actions/`.
- `action_already_handled` — the action has `status: done` /
  `status: dismissed` / `status: snoozed` with `snoozed_until` in the
  future.
- `compose_payload_missing` — neither `## Compose payload` nor
  `## Compose payload (gmail)` is present in the action body.

The component renders a friendly error banner for each.
