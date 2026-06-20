# agntux-mercury

Track Mercury balances, transactions, cards, and pending approvals in AgntUX.

## What this plugin does

The agntux-mercury plugin brings your Mercury business banking into AgntUX so you can see:

- **Account balances** — checking, savings, and treasury account balances at a glance
- **Transactions** — money in and out with counterparty, category, and pending vs. posted status
- **Cards** — virtual and physical card status, spend limits, and recent activity
- **Mercury credit** — available credit limit and current IO balance
- **Pending approvals** — send money requests waiting for your sign-off
- **Invoices** — incoming and outgoing invoices with due dates and status
- **Customers and recipients** — saved payment contacts and invoice partners

All Mercury data surfaces in your AgntUX work triage so you can stay on top of cash flow, spending, and pending actions without context-switching.

## How to use it

Type `/agntux-mercury` to check for new transactions and approvals now. Or ask a natural-language question about your Mercury — the plugin will search your accounts, balances, cards, and records.

Examples:
- `/agntux-mercury` (check for new activity)
- `/agntux-mercury How much credit do I have left?` (look up available credit)
- `/agntux-mercury Show me pending approvals` (list sign-offs you need)
- `/agntux-mercury What did I spend on marketing this month?` (query by category)

## What counts as actionable

The plugin surfaces items that need you:

- **Pending send money approvals** — waiting for your authorization
- **Overdue invoices** — due dates that have passed
- **Low balance alerts** — when an account dips below its typical range
- **Unusual transaction patterns** — marked as likely recurring or automated based on amount, counterparty, and cadence
- **Card status changes** — activation, locking, or deactivation events
- **New credit available** — when Mercury IO limit increases

Everything else is informational — it stays in Mercury and surfaces in AgntUX only when it changes or needs attention.

## Known limitations

**Mercury automations (auto-transfer rules):** Mercury offers auto-transfer and recurring payment rules, but the connector exposes no endpoint to read their definitions. Only the resulting transactions are visible — you see the money move, but not the automation rule that triggered it. If you need to review or edit auto-transfer rules, open Mercury directly.

**Inferred automation labels:** The plugin labels recurring transactions as "likely automated" based on pattern analysis (same counterparty + amount + regular cadence, or explicit "recurring" language in the transaction description). This is inferred, never authoritative — always verify the actual transaction.

## Setup

1. Connect your Mercury business banking account to AgntUX via the Mercury connector.
2. Install agntux-mercury.
3. Run `/agntux-mercury` to pull your first sync.
4. Customize the ingest schedule in AgntUX settings (default: every hour during work hours).

## Support

If you hit issues or want to suggest a feature, open an issue at [github.com/AgntUX/AUX-plugins](https://github.com/AgntUX/AUX-plugins/issues) or email support@agntux.ai.

## License

Apache License 2.0
