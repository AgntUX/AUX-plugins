# agntux-zoom

Brings your Zoom into AgntUX so you never miss a meeting action item. See when you have recordings waiting, check AI-generated summaries, and save meeting outcomes directly to Zoom Docs.

## Features

- **Meeting digest**: A daily summary of your Zoom meetings with participants and timing
- **Recordings & transcripts**: Automatic indexing of meeting recordings and full transcripts
- **AI summaries**: Quick-scan summaries of key points from each meeting
- **Action items**: Surfaces meeting next steps and decisions awaiting your input
- **Team Chat**: Brings in unread messages and mentions from Zoom Team Chat
- **Quick save**: Save a meeting summary and action items to a Zoom Doc with one click

## Installation

1. Install the Zoom MCP connector via AgntUX Host.
2. In AgntUX, enable the **agntux-zoom** plugin.
3. Type `/agntux-zoom sync` to start the initial sync, or wait for the daily 7am—7pm cadence.

## Usage

### Check for new meetings

Type `/agntux-zoom` (or `/agntux-zoom sync`) to pull the latest:
- Upcoming and past meetings
- Recordings waiting to be reviewed
- Unread Team Chat messages
- Action items from recent meetings

### Ask about your Zoom

Ask natural-language questions like:
- "What did I miss in yesterday's all-hands?"
- "Do I have any recordings from this week?"
- "Who's on the team meeting tomorrow?"

### Save a meeting summary to Zoom

When viewing a meeting summary in AgntUX, click **Save to Zoom Doc** to create a new Zoom Doc with the summary and action items. The Doc opens in Zoom so you can share it with your team.

## Entity types

The plugin surfaces these Zoom entities:

- **Meetings**: Scheduled or completed meetings with participants and duration
- **Recordings**: Meeting videos with auto-generated transcripts
- **Transcripts**: Full transcripts with speaker labels and timestamps
- **Meeting summaries**: AI-generated key points and outcomes
- **Team Chat messages**: Unread or recent messages from Zoom Team Chat
- **Zoom Docs**: Collaborative notes and shared documents
- **Participants**: People on your team and attendees

## Action items

The plugin creates action items for:

- **Deadlines**: Upcoming meetings or scheduled follow-ups
- **Response needed**: Follow-up questions, action items, or decisions from meetings
- **Knowledge updates**: Recordings and summaries to review
- **Risks**: Missed meetings or unread high-priority messages
- **Opportunities**: Notable meeting outcomes or collaboration ideas

## Ingest cadence

By default, agntux-zoom checks for new meetings every 30 minutes during work hours (7am–7pm) on weekdays. You can customize this in AgntUX settings.

## Troubleshooting

**"No meetings found"**: Make sure the Zoom MCP connector is installed and you've authenticated with your Zoom account.

**"Recordings not showing"**: Zoom recordings can take a few minutes to appear after a meeting ends. Wait a few minutes and re-sync.

**"Team Chat messages missing"**: If you don't see Team Chat, verify your Zoom account has chat enabled and the connector has permission to read messages.

## Feedback

Found a bug or have a feature request? Open an issue at https://github.com/AgntUX/AUX-plugins/issues
