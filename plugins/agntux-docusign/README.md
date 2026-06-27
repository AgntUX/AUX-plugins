# agntux-docusign

DocuSign e-signature workflow in your AgntUX knowledge store.

## What this plugin does

Tracks DocuSign envelopes out for signature, surfaces what's waiting on whom (including what's waiting on you to sign), notices completed/declined/voided envelopes, and flags agreements with upcoming renewal/expiration dates.

## Features

- **Envelope tracking** — See signature requests with their current status and who still needs to sign.
- **Action items** — Get notified about envelopes waiting on you to sign, pending signer reminders, and upcoming agreement renewals/expirations.
- **Quick actions** — Send reminder nudges to pending signers, void envelopes with a reason, or open an envelope to sign it securely in DocuSign.

## Installation

This plugin requires the DocuSign MCP connector to be installed on your host.

## Contract

See `agents/agntux-docusign/` for the runtime ingest contract and action-item schemas.
