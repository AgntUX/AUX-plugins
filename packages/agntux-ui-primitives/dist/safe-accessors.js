/**
 * safe-accessors — defensive coercion helpers for streaming/partial payloads.
 *
 * Author: AgntUX
 * License: ELv2
 *
 * Every helper returns a fully-defaulted value of its declared type so that
 * `undefined` never propagates into JSX where `.map`, `.length`, or
 * `.toUpperCase` will be called on it. Use these inside a `parsePayload()`
 * helper for every field read out of `toolOutput`.
 *
 * Contract:
 *   - `safeArray<T>` always returns a `T[]` (empty on bad input).
 *   - `safeString` always returns a `string` (default `''`).
 *   - `safeNumber` always returns a `number` (default `0`).
 *   - `safeBoolean` always returns a `boolean` (default `false`).
 *   - `safeObject` always returns a `Record<string, unknown>` (default `{}`).
 *   - `safeEnum<T extends string>(value, allowed[], fallback)` returns one of
 *     `allowed[]` or `fallback`.
 *   - `safeDate` returns `Date | undefined` (never synthesises `new Date()`
 *     because the host is single-writer for clocks).
 *   - `formatTime(date)` returns a locale-formatted string or `'—'` if the
 *     date is missing/invalid.
 *   - `daysSince(date)` returns a non-negative integer day-count or `'—'` if
 *     the date is missing/invalid.
 */
/**
 * Coerce an unknown value to `T[]`. Returns `[]` if `value` is not an array.
 *
 * @example
 *   const items = safeArray<string>(payload.tags);
 */
export function safeArray(value) {
    return Array.isArray(value) ? value : [];
}
/**
 * Coerce an unknown value to `string`. Returns the provided fallback (default
 * `''`) when `value` is not a string.
 */
export function safeString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
}
/**
 * Coerce an unknown value to `number`. Returns the provided fallback (default
 * `0`) for non-finite numbers, strings, booleans, or other types.
 */
export function safeNumber(value, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
/**
 * Coerce an unknown value to `boolean`. Returns the provided fallback (default
 * `false`) when `value` is not a boolean.
 */
export function safeBoolean(value, fallback = false) {
    return typeof value === "boolean" ? value : fallback;
}
/**
 * Coerce an unknown value to `Record<string, unknown>`. Arrays and `null`
 * return `{}`. Use `safeArray` for array fields.
 */
export function safeObject(value) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
}
/**
 * Coerce an unknown value to one of the strings in `allowed`. If `value` is
 * not a member of `allowed`, returns `fallback`.
 *
 * @example
 *   const status = safeEnum(payload.status, ['draft', 'sent', 'failed'] as const, 'draft');
 *   // status: 'draft' | 'sent' | 'failed'
 */
export function safeEnum(value, allowed, fallback) {
    return typeof value === "string" &&
        allowed.includes(value)
        ? value
        : fallback;
}
/**
 * Coerce an unknown value to `Date | undefined`. Accepts ISO-8601 strings,
 * epoch-millisecond numbers, or Date instances. Returns `undefined` when the
 * input cannot be parsed into a valid date.
 *
 * NOTE: never synthesises `new Date()` — the host is the single writer for
 * clock values. This is by design.
 */
export function safeDate(value) {
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value : undefined;
    }
    if (typeof value === "string" && value.length > 0) {
        const parsed = new Date(value);
        return Number.isFinite(parsed.getTime()) ? parsed : undefined;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        const parsed = new Date(value);
        return Number.isFinite(parsed.getTime()) ? parsed : undefined;
    }
    return undefined;
}
/**
 * Format a date as a locale-aware time string. Returns `'—'` for invalid or
 * missing dates so the UI never renders the literal string `"Invalid Date"`.
 */
export function formatTime(value, locale, options = { hour: "numeric", minute: "2-digit" }) {
    const date = safeDate(value);
    if (!date)
        return "—";
    try {
        return new Intl.DateTimeFormat(locale, options).format(date);
    }
    catch {
        return "—";
    }
}
/**
 * Compute whole days elapsed since `value`. Returns `'—'` for invalid or
 * missing dates. Negative deltas are clamped to `0`.
 */
export function daysSince(value, now = new Date()) {
    const date = safeDate(value);
    if (!date)
        return "—";
    const ms = now.getTime() - date.getTime();
    if (!Number.isFinite(ms))
        return "—";
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    return days < 0 ? 0 : days;
}
