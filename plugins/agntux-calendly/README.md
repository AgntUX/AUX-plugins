# agntux-calendly

Calendly scheduling plugin for AgntUX. Surfaces your bookings, leads, and attendee statuses into the knowledge store, with one-click actions to cancel meetings, confirm attendance, and send follow-ups.

## What it does

- **Watches your Calendly** for new bookings, inbound scheduling requests, and attendee status changes.
- **Surfaces action items** into AgntUX triage: new leads, upcoming meetings needing confirmation, and no-show follow-ups.
- **Enables one-click actions**: cancel meetings with a reason, mark attendees as no-show, and generate single-use booking links.

## Setup

1. Connect your Calendly account via the Calendly connector.
2. Enable the agntux-calendly plugin.
3. Run `/agntux-calendly` to check for new bookings and leads, or ask questions about your Calendly.

## Sync cadence

The plugin checks for updates every 30 minutes during business hours (7 AM–7 PM, weekdays, in your local timezone). Overnight and weekends are skipped to conserve processing.

## Actions

- **Cancel a meeting** — Cancel a scheduled event with a reason note.
- **Mark as no-show** — Record that an attendee did not attend.
- **Create a booking link** — Generate a single-use scheduling link for a meeting type.

## Learn more

See the [marketplace listing](https://agntux.ai) for detailed documentation and example workflows.
