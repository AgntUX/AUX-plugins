# agntux-notion

Brings your Notion workspace into AgntUX, so tasks, projects, and pages that need you show up in one place. Reply to comments, update page properties, and create new pages without leaving AgntUX.

## What it does

- **Ingest**: Pulls your Notion pages, databases, and comment threads into AgntUX every 4 hours.
- **Surface action items**: Tasks, updates, and comments that need your attention appear in AgntUX triage.
- **Write back**: Reply to comments, update page properties, and create new pages via one-click actions.

## How to use

1. Install the plugin and connect your Notion workspace.
2. Type `/agntux-notion` to check for new activity from Notion.
3. Or ask a question about your Notion — it searches and surfaces relevant pages and items.
4. Use the action buttons to reply to comments, update pages, or create new ones.

## Features

### Read
- Search and browse pages in your Notion workspace
- View database items, tasks, and projects
- See comments and mention threads
- Track page properties and metadata

### Write
- **Reply to comment**: Add responses to comments on pages and database items.
- **Update page**: Edit page properties, titles, and fields.
- **Create page**: Add new pages to your Notion workspace.

## Schema

The plugin ingests Notion pages, database items (rows), and comments as entities. It surfaces action items for:

- Comments that mention you or await your reply (`response-needed`)
- Pages and items that were recently updated (`knowledge-update`)
- Tasks with due dates (`deadline`)
- Important or flagged items (`opportunity`)

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE) for details.
