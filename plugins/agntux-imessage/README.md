# agntux-imessage

Brings your iMessages into AgntUX so conversations that need you show up in one place, sorted by priority.

## What it does

The agntux-imessage plugin watches your iMessage conversations and surfaces three priority tiers:

1. **Needs you** (high priority) — messages from known contacts you message regularly, especially when they're asking a direct question or waiting for a reply.
2. **Personal / FYI** (medium priority, collapsed) — messages from real people that are informational or just need acknowledgement.
3. **Promotional & automated** (low priority, dimmed) — short-code senders (like `123456`), verification codes, and marketing messages.

Each conversation shows up as an action item you can read in context. You can also ask questions about your messages — the plugin looks them up and answers in plain language, without adding anything to your task list.

## Sending replies

When you want to reply, the plugin drafts a message for you. You review it, make any changes, and send—all safely in AgntUX before anything goes to iMessage.

## How it syncs

The plugin checks for new messages every 15 minutes during work hours (7am–7pm in your local timezone, weekdays only). Messages are indexed by the sender's phone number or email, so you see all conversations from each person in one place.

## Contacts and privacy

The plugin brings in basic contact details (name, phone, email) so you know who's writing. It does not store message content itself—it reads iMessages on-device and surfaces only the signals that need your attention.

## Source

agntux-imessage requires the iMessage MCP server, which is host-provided on macOS and iOS.
