// =============================================================================
// format-date.ts — date/time formatting utilities for the compose component.
//
// All helpers return '—' (em-dash) for invalid/missing dates, never the literal
// string "Invalid Date". This is the briefing-learnings §1.5 defensive em-dash
// convention: the fallback is a typographically correct em-dash, not an empty
// string that might be invisible to the user.
// =============================================================================

/**
 * Parse an ISO 8601 or other parseable date string to a Date, returning null
 * on failure. Never synthesises new Date() — the host is single-writer for
 * clocks (briefing-learnings §1.5).
 */
export function safeDate(iso: unknown): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Format a date as a locale-aware time string, e.g. "2:30 PM".
 * Returns '—' for invalid or missing dates.
 */
export function formatTime(iso: unknown, fallback = "—"): string {
  const d = safeDate(iso);
  if (!d) return fallback;
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return fallback;
  }
}

/**
 * Format a date as a locale-aware date+time string, e.g. "May 5, 2026, 2:30 PM".
 * Returns '—' for invalid or missing dates.
 */
export function formatDateTime(iso: unknown, fallback = "—"): string {
  const d = safeDate(iso);
  if (!d) return fallback;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return fallback;
  }
}

/**
 * Format an ISO date string for use as an HTML <input type="datetime-local">
 * value attribute, e.g. "2026-05-05T09:00". Returns '' on failure (the input
 * will be empty rather than invalid).
 */
export function toDatetimeLocalValue(iso: unknown): string {
  const d = safeDate(iso);
  if (!d) return "";
  // Produce yyyy-MM-ddTHH:mm in local time (not UTC) because
  // datetime-local inputs always work in local time.
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${min}`;
}

/**
 * Convert a datetime-local input value (e.g. "2026-05-05T09:00") to an ISO
 * 8601 string with timezone offset. Returns null on failure.
 */
export function datetimeLocalToISO(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * Produce a default schedule time of "tomorrow 09:00 in user's local timezone".
 * Returns an ISO string. Uses new Date() once here — this is the one place
 * where the component synthesises a clock value (acceptable since it is used
 * only as a UI default, not persisted).
 */
export function defaultScheduleTime(): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow.toISOString();
}
