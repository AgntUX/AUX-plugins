# agntux-google-calendar

Daily look-ahead of your calendar with prep context pulled from your AgntUX store.

## Overview

The Google Calendar plugin ingests your calendar events, creates action items for upcoming meetings, and enriches each with prep context — related Slack threads, Gmail conversations, prior notes — summarised inline and linked back to source.

## Features

- **Daily ingest**: Early-morning sync reads the next 7 days of events across all your calendars
- **Prep context**: Automatically surfaces related communications and notes from your AgntUX store
- **Schedule meetings**: Find-a-time via Google Calendar's suggest_time API and create events directly
- **Respond to invites**: Accept, tentatively accept, or decline invites with optional notes to organiser
- **Conflict detection**: Highlights double-bookings and overlapping critical meetings

## Installation

The plugin requires the `agntux-core` plugin and Google Calendar MCP connector.

## Support

For issues and feature requests, see the [AgntUX plugins repo](https://github.com/AgntUX/AUX-plugins/issues?q=label%3Aagntux-google-calendar).

Contact: support@agntux.ai
