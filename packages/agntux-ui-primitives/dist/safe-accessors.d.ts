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
export declare function safeArray<T = unknown>(value: unknown): T[];
/**
 * Coerce an unknown value to `string`. Returns the provided fallback (default
 * `''`) when `value` is not a string.
 */
export declare function safeString(value: unknown, fallback?: string): string;
/**
 * Coerce an unknown value to `number`. Returns the provided fallback (default
 * `0`) for non-finite numbers, strings, booleans, or other types.
 */
export declare function safeNumber(value: unknown, fallback?: number): number;
/**
 * Coerce an unknown value to `boolean`. Returns the provided fallback (default
 * `false`) when `value` is not a boolean.
 */
export declare function safeBoolean(value: unknown, fallback?: boolean): boolean;
/**
 * Coerce an unknown value to `Record<string, unknown>`. Arrays and `null`
 * return `{}`. Use `safeArray` for array fields.
 */
export declare function safeObject(value: unknown): Record<string, unknown>;
/**
 * Coerce an unknown value to one of the strings in `allowed`. If `value` is
 * not a member of `allowed`, returns `fallback`.
 *
 * @example
 *   const status = safeEnum(payload.status, ['draft', 'sent', 'failed'] as const, 'draft');
 *   // status: 'draft' | 'sent' | 'failed'
 */
export declare function safeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T;
/**
 * Coerce an unknown value to `Date | undefined`. Accepts ISO-8601 strings,
 * epoch-millisecond numbers, or Date instances. Returns `undefined` when the
 * input cannot be parsed into a valid date.
 *
 * NOTE: never synthesises `new Date()` — the host is the single writer for
 * clock values. This is by design.
 */
export declare function safeDate(value: unknown): Date | undefined;
/**
 * Format a date as a locale-aware time string. Returns `'—'` for invalid or
 * missing dates so the UI never renders the literal string `"Invalid Date"`.
 */
export declare function formatTime(value: unknown, locale?: string, options?: Intl.DateTimeFormatOptions): string;
/**
 * Compute whole days elapsed since `value`. Returns `'—'` for invalid or
 * missing dates. Negative deltas are clamped to `0`.
 */
export declare function daysSince(value: unknown, now?: Date): number | "—";
