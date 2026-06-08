   - If that token instead equals `schedule` — or the request reads as a
     scheduling ask ("find a time", "set up a meeting", "book time") — strip
     the keyword and load `reference/schedule.md` (the user-initiated
     scheduling lane), NOT `ask.md`.
