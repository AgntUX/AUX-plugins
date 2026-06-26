# agntux-asana

Bring your Asana tasks and projects into your AgntUX knowledge store. See what needs your attention, add comments, reassign work, and create follow-up tasks — all without leaving AgntUX.

## What it does

The **agntux-asana** plugin ingests your Asana tasks, projects, and updates on a schedule you choose. Then:

- **See your work** — Tasks with due dates, assignees, and status all show up in AgntUX.
- **Ask about your Asana** — Type `/agntux-asana` to search and ask questions about your work in Asana.
- **Take action** — Comment on tasks, mark them complete, reassign work, or create new tasks directly from AgntUX.

## Quick start

1. Install the plugin from the AgntUX marketplace.
2. Connect your Asana account when prompted.
3. Choose your sync cadence (default: hourly during work hours).
4. Start using `/agntux-asana` to check for new work or ask about your projects.

## What gets ingested

- **Tasks** — Titles, due dates, assignees, and status.
- **Projects** — Names, owners, and member lists.
- **Portfolios** — High-level grouping of related projects.
- **Comments & activity** — Recent updates on tasks you're involved in.

## Actions available

- **Comment** — Add a comment to any task.
- **Complete** — Mark a task done or change its due date.
- **Assign** — Reassign a task to a team member.
- **Create** — Start a new task in Asana.

## Sync cadence

By default, agntux-asana checks for new work every 60 minutes during weekday work hours (7 AM–7 PM in your local timezone). Customize this in your plugin settings.

## Support

Found a bug or have a feature request? Open an issue at [github.com/AgntUX/AUX-plugins/issues](https://github.com/AgntUX/AUX-plugins/issues), or email [support@agntux.ai](mailto:support@agntux.ai).

## License

Apache License 2.0 — see [LICENSE](./LICENSE) for details.
