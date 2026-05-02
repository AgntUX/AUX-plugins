# AgntUX Core

The AgntUX orchestrator. Triages action items and queries your knowledge store.

## What it does

AgntUX Core is the foundation plugin that all other AgntUX plugins build upon. It maintains
your knowledge store, triages action items according to your preferences, and coordinates
between ingest plugins to keep your data fresh and organized.

## Install

Install AgntUX Core first before installing any other AgntUX plugin. It provides the
shared knowledge store and orchestration layer that other plugins depend on.

## Configuration

Configure your preferences in `<agntux project root>/user.md`. This file controls how the orchestrator
prioritizes action items and manages your workflow.

## Limitations

- Requires at least one ingest plugin to populate the knowledge store with real data.
- Knowledge store lives on your local machine; no cloud sync at MVP.

## License

Elastic License v2 (ELv2). See LICENSE for details.
