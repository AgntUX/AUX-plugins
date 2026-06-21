# agntux-stripe

Tracks changes across your Stripe account and surfaces action items when payments, invoices, subscriptions, disputes, or other events need attention.

## What it does

The plugin syncs your Stripe account hourly (7am–7pm weekdays, your local time) and tracks these resource families:

- **Charges & Payments** — payment status changes, refunds needed
- **Invoices** — new invoices, payment deadlines, finalization or void actions
- **Subscriptions** — new subscriptions, updates, cancellations, pause/resume
- **Customers** — new customer accounts, customer info changes
- **Disputes** — chargeback events, evidence needed
- **Refunds** — refund status changes
- **Coupons** — new discount codes and promotions
- **Products & Prices** — product and pricing updates
- **Payout Transfers** — money moved to your bank account
- **Payment Method Configurations** — payment method setup and changes

## Write actions

Six action buttons let you take immediate steps without leaving AgntUX:

1. **Refund a payment** — issue a full or partial refund
2. **Respond to a dispute** — submit evidence to fight a chargeback
3. **Finalize an invoice** — mark an invoice as sent
4. **Void an invoice** — cancel an unpaid invoice
5. **Pause/update a subscription** — pause, unpause, or change a subscription
6. **Cancel a subscription** — end a subscription

## Requirements

- An AgntUX project (any directory named `agntux`)
- The Stripe connector installed in your AgntUX host
- AgntUX desktop app, running and signed in

## License

Apache License 2.0. See LICENSE and NOTICE files for details.
