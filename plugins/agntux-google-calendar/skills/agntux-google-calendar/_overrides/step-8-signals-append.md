## Step 8 — Google Calendar raise/suppress signals

### Always raise

- **`response-needed`**: `attendee.self.responseStatus == "needsAction"` — raise regardless of timing within the 7-day window.
- **`risk`**: double-booking (overlapping accepted/tentative events) — `priority: high` regardless of calendar.
- **`meeting-prep`** with VIP attendees: attendee tagged `always-flag` in `user.md → # People` → `priority: high` even if 5–7 days out.

### Suppress

- **All-day events** (`event.start.date`, no `dateTime`): log `skipped: all-day-event`.
- **Solo events** (no attendees or user is only attendee): log `skipped: solo-event`.
- **Read-only calendar events** with no conflict: skip action item; retain for conflict detection.
- **Cancelled events**: handled in Step 5e; do not raise.
- **Existing open action item** for same `source_id`: update existing item body, do not create a new file.
- **User declined**: skip; auto-resolve any open action item: `status: done`, `resolution: "auto-resolved — user declined"`.

### Priority calibration

**External-attendee bump:** if any attendee's email domain differs from the user's own primary email domain (read `user.md → # Identity → Email`, extract the part after `@`), bump the computed priority one level (low → medium, medium → high). Exception: when `event.creator.self === true`, the user organised the event — routine outreach, no bump.

| Class | Condition | Priority |
|---|---|---|
| `response-needed` | Within 24h | `high` |
| `response-needed` | 1–7 days out | `medium` |
| `risk` | Any | `high` |
| `meeting-prep` | VIP or same day | `high` |
| `meeting-prep` | 1–4 days out | `medium` |
| `meeting-prep` | 5–7 days out | `low` |
| `deadline` | Any | `low` |
| Any class | External attendee present (user not organiser) | bump +1 level |
