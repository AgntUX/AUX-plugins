// stripe-helpers.ts — shared formatting utilities for Stripe UI components.

/**
 * Format a Stripe amount (minor units, e.g. cents) into a display string.
 * e.g. formatAmount(1099, "usd") => "$10.99"
 */
export function formatAmount(minorUnits: number, currency: string): string {
  if (!currency) return String(minorUnits);
  try {
    const amount = minorUnits / 100;
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/**
 * Format an ISO-8601 date string into a short display date.
 * e.g. "2026-07-15T00:00:00Z" => "Jul 15, 2026"
 */
export function formatDate(isoOrUnix: string | number): string {
  if (!isoOrUnix) return '';
  try {
    const d =
      typeof isoOrUnix === 'number'
        ? new Date(isoOrUnix * 1000)
        : new Date(isoOrUnix);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return String(isoOrUnix);
  }
}
