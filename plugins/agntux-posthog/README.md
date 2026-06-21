# agntux-posthog

**Bring your PostHog analytics signals into AgntUX for faster decision-making.**

The agntux-posthog plugin watches your PostHog project for the analytics signals that need a human decision—error tracking issues, fired alerts, experiment results, comment mentions, and flagged inbox reports—and brings them into your AgntUX knowledge store so they appear in one central triage hub.

## What you get

- **Error issues**: See which errors are affecting your users, with stack traces and user impact. Triage or mark as resolved directly from AgntUX.
- **Alert firings**: Get notified when your configured alerts fire, with metric context. Acknowledge alerts and take action without leaving your triage space.
- **Experiment decisions**: Track ongoing A/B tests and multivariate experiments. Review results and decide on rollout or shutdown with one-click actions.
- **Comment mentions**: See when teammates mention you in PostHog discussions. Reply or add context directly from AgntUX.
- **Flagged reports**: Watch your PostHog inbox for flagged anomaly reports and data quality issues. Mark as seen or act on recommendations.

## How to use it

### Check for new signals

Type `/agntux-posthog` to pull the latest errors, alerts, experiments, comments, and inbox items from your PostHog project. The plugin syncs automatically every hour during your work hours (7am–7pm weekdays local time).

### Ask about your analytics

Ask AgntUX a natural-language question about your PostHog data—"What errors hit our users in the past 24 hours?", "Are any experiments winning?", "What anomalies has PostHog flagged?"—and it will search your PostHog knowledge store and answer directly. No manual lookups needed.

### Act on signals

Use the action buttons in AgntUX to:
- Resolve or reopen an error issue
- Acknowledge or snooze an alert
- Decide on an experiment variant (ship, archive, extend)
- Reply to a comment thread
- Mark an inbox report as reviewed

All actions sync back to your PostHog project in real time.

## Setup

1. **Install the plugin** from the AgntUX marketplace.
2. **Connect your PostHog project** using the PostHog connector (you'll authenticate once).
3. **Run `/agntux-posthog`** to pull your first batch of signals.
4. **Enable scheduled syncs** if you want automatic hourly updates (the default).

## Feedback

Questions or issues? Open an issue at [AgntUX Plugins](https://github.com/AgntUX/AUX-plugins/issues) or email support@agntux.ai.
