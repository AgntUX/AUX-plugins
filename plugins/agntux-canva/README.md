# agntux-canva

Brings your Canva designs and comments into AgntUX so you see what needs your attention. Reply to comments, add your own, and export designs—all from your action list.

## Features

- **Ingest Canva designs** — syncs your designs from Canva and tracks them as entities in AgntUX.
- **Surface comments and mentions** — automatically creates action items for comments and mentions on designs so you don't miss feedback.
- **One-click replies** — respond to comments directly from your action list without leaving AgntUX.
- **Add comments** — comment on any design to collaborate with your team.
- **Export designs** — export your designs to various formats with a single action.

## Installation

This plugin requires the Canva MCP connector to be installed and configured in your AgntUX host. Once the connector is available, the plugin will automatically discover your Canva account.

## Usage

Type `/agntux-canva` to check for new Canva comments and mentions. You can also ask questions about your designs and the plugin will look up relevant information.

## Action Items

The plugin surfaces three types of action items:

- **Comments needing replies** — tagged as `response-needed` when someone comments on your design.
- **Informational comments** — tagged as `knowledge-update` when a comment shares useful information.
- **Other Canva actions** — tagged as `other` for comments that don't fit the above categories.

## Contract

For details on the schema, entity types, and action class definitions, see the `proposed_schema` block in `marketplace/listing.yaml`.

## License

Licensed under the Apache License, Version 2.0. See LICENSE for details.
