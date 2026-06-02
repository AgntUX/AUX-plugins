## Step 4 — Google Calendar look-ahead window (forward-only)

This plugin is **forward-looking only.** The canonical bootstrap/incremental
distinction does NOT apply — the fetch window is always fixed:

```
startTime = now()             (current RFC3339 timestamp at run time)
endTime   = now() + 7 days
```

The Calendar API queries by event start time; modification-time diffing is
per-event via the cursor map (`reference/cursor.md`). `bootstrap_window_days`
is ignored — look-ahead is always 7 days.

**Log the following at this step:**

```
google-calendar fetch window: {now_rfc3339} → {endTime_rfc3339}
cursor map size: {N} entries
volume cap: 80 events/run
```
