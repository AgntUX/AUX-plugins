// =============================================================================
// datetime-picker.tsx — wrapper around <input type="datetime-local"> that
// emits an ISO string and handles local timezone display.
// =============================================================================

import { toDatetimeLocalValue, datetimeLocalToISO } from "../lib/format-date.js";

interface DatetimePickerProps {
  /** Current ISO 8601 value (or null for unset). */
  value: string | null;
  /** Called with an ISO 8601 string on change, or null when cleared. */
  onChange: (iso: string | null) => void;
  /** Minimum selectable datetime as ISO string (defaults to now). */
  min?: string;
  label?: string;
  disabled?: boolean;
}

/**
 * DatetimePicker — renders a native datetime-local input with ISO I/O.
 * The input always works in the user's local timezone (browser-native).
 * Emits null when the field is empty.
 */
export function DatetimePicker({
  value,
  onChange,
  min,
  label = "Send at",
  disabled = false,
}: DatetimePickerProps) {
  const inputValue = value ? toDatetimeLocalValue(value) : "";
  const minValue = min ? toDatetimeLocalValue(min) : "";

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        type="datetime-local"
        aria-label={label}
        data-testid="datetime-picker"
        value={inputValue}
        min={minValue || undefined}
        disabled={disabled}
        onChange={(e) => {
          const iso = datetimeLocalToISO(e.target.value);
          onChange(iso);
        }}
        className={[
          "rounded border border-input bg-background px-2 py-1 text-sm",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      />
    </div>
  );
}
