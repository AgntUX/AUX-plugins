// Hooks talk to the user via stderr. The host surfaces stderr from a
// blocking hook to the user verbatim; SessionStart non-blocking output is
// appended to the session log. Keep messages short, actionable, link out
// to a URL.

const PREFIX = "[AgntUX licence] ";

export function info(msg) {
  process.stderr.write(PREFIX + msg + "\n");
}

export function err(msg) {
  process.stderr.write(PREFIX + msg + "\n");
}

export function trialExpired(upgradeUrl) {
  return `Your trial has ended. Upgrade to keep using AgntUX plugins:\n  ${upgradeUrl || "https://app.agntux.ai/upgrade"}`;
}

export function lapsed(upgradeUrl) {
  return `Your subscription billing failed. Update payment:\n  ${upgradeUrl || "https://app.agntux.ai/billing"}`;
}

export function subscriptionCanceled(upgradeUrl) {
  return `Your subscription has ended. Reactivate to resume:\n  ${upgradeUrl || "https://app.agntux.ai/billing"}`;
}

export function noSession() {
  return "No AgntUX session on this device. Open https://app.agntux.ai/connect to pair this device.";
}

export function deviceLimit() {
  return "Device limit reached. Deauthorise an existing device at https://app.agntux.ai/devices.";
}

export function expiredRestart() {
  return "Session licence expired. Restart the host to refresh.";
}

export function noCacheNoNetwork(reason) {
  return `Cannot reach AgntUX (${reason || "network"}) and no cached licence. Connect to the internet and retry.`;
}

export function invalidSession() {
  return "Session expired. Re-authenticate at https://app.agntux.ai/connect.";
}
