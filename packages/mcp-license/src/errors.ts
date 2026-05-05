// Structured MCP error envelopes returned from `requireValidLicense()`.
//
// The text content is written for the LLM to surface verbatim or paraphrase
// to the user — clear, sentence-by-sentence, with a clickable URL.

export interface StructuredError {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
}

export type ErrorKind =
  | "pairing_required"
  | "pairing_pending"
  | "pairing_failed"
  | "trial_expired"
  | "subscription_lapsed"
  | "subscription_canceled"
  | "device_limit_exceeded"
  | "invalid_session"
  | "network_unavailable";

export interface ErrorContext {
  pluginName: string;
  apiBase: string;
  verificationUrl?: string;
  upgradeUrl?: string;
  detail?: string;
}

function envelope(text: string): StructuredError {
  return {
    isError: true,
    content: [{ type: "text", text }],
  };
}

export function buildErrorEnvelope(
  kind: ErrorKind,
  ctx: ErrorContext,
): StructuredError {
  const billing = `${ctx.apiBase}/billing`;

  switch (kind) {
    case "pairing_required": {
      // verificationUrl SHOULD always be set by the gate before returning
      // this kind. The fallback exists only as defence-in-depth — directing
      // users to the marketing site is more useful than a 404 from
      // `${apiBase}/connect/<missing-nonce>`.
      const url = ctx.verificationUrl ?? ctx.apiBase;
      return envelope(
        `${ctx.pluginName} requires pairing before this tool can run.\n\n` +
          `Pair this device → ${url}\n\n` +
          `Steps:\n` +
          `  1. Open the link above\n` +
          `  2. Enter your email\n` +
          `  3. Click the approval link in your inbox\n` +
          `  4. Run this command again\n\n` +
          `This pairing link expires in 15 minutes.`,
      );
    }
    case "pairing_pending": {
      const url = ctx.verificationUrl ?? ctx.apiBase;
      return envelope(
        `Pairing is in progress.\n\n` +
          `Check your inbox for the AgntUX approval email and click "Approve". ` +
          `If the email hasn't arrived, return to ${url} and request a new one.\n\n` +
          `After approving, run this command again.`,
      );
    }
    case "pairing_failed":
      return envelope(
        `Could not start the pairing flow${ctx.detail ? ` (${ctx.detail})` : ""}.\n\n` +
          `Check your network connection and try again. If the problem persists, ` +
          `contact support@agntux.ai.`,
      );
    case "trial_expired":
      return envelope(
        `Your AgntUX trial has ended.\n\n` +
          `Subscribe to keep using ${ctx.pluginName} → ${ctx.upgradeUrl ?? billing}`,
      );
    case "subscription_lapsed":
      return envelope(
        `Your AgntUX subscription billing failed.\n\n` +
          `Update your payment method to keep using ${ctx.pluginName} → ${ctx.upgradeUrl ?? billing}`,
      );
    case "subscription_canceled":
      return envelope(
        `Your AgntUX subscription has ended.\n\n` +
          `Reactivate to keep using ${ctx.pluginName} → ${ctx.upgradeUrl ?? billing}`,
      );
    case "device_limit_exceeded":
      return envelope(
        `Device limit reached for your AgntUX account.\n\n` +
          `Email support@agntux.ai with the name of a previously-paired device ` +
          `to revoke; then run this command again.`,
      );
    case "invalid_session":
      return envelope(
        `Your AgntUX session is no longer valid.\n\n` +
          `Run this command again to re-pair this device.`,
      );
    case "network_unavailable":
      return envelope(
        `Cannot reach AgntUX (${ctx.detail ?? "network"}).\n\n` +
          `Connect to the internet and run this command again.`,
      );
  }
}
