# agntux-dropbox

Bring your Dropbox files into your AgntUX knowledge store, and act on them — share, organize, request — right from triage.

## Overview

This plugin syncs your Dropbox files, folders, shared links, and file requests into AgntUX so they show up alongside everything else that needs your attention. Check for updates with `/agntux-dropbox`, search your files, and take action without leaving triage.

### What you can do

**Check for new Dropbox activity** — Run `/agntux-dropbox` to see what's changed since the last sync. The plugin brings in file metadata, folder structure, sharing permissions, and file requests.

**Search your Dropbox** — Ask a natural-language question like "show me all PDFs from marketing" or "which folders did I update yesterday?" The plugin looks it up across your files.

**Share a file instantly** — Select a file and create a shareable link. Choose who can access (anyone, specific people, or team-only) and whether they can download, preview, or just view.

**Organize files** — Move files to a different folder or copy them. Pick the destination and confirm; the plugin handles it.

**Create a new folder** — Give it a name and choose where it goes.

**Request uploads** — Set up a file request link. People can upload files without needing a Dropbox account.

## Setup

1. Connect your Dropbox account when you install the plugin.
2. AgntUX syncs your files every 4 hours, 7am–7pm on weekdays in your local timezone.
3. Run `/agntux-dropbox` to see what's new, or ask a question about your files.

## What gets synced

- File names, sizes, timestamps, and sharing status
- Folder structure and hierarchy
- Shared links and permissions
- File requests

## Sync frequency

By default, the plugin checks Dropbox every 4 hours during work hours (7am–7pm weekdays in your local timezone). If you need a different cadence, ask your AgntUX admin to adjust it in settings.

## Support

For issues, feature requests, or questions, open an issue at [AgntUX Plugins](https://github.com/AgntUX/AUX-plugins/issues).
