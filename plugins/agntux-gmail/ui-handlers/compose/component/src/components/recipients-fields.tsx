// =============================================================================
// recipients-fields.tsx — editable To / CC / BCC inputs.
//
// Each row is a comma-separated email-address input. We do NOT validate
// strictly here — the server-side `create_draft` call will reject malformed
// addresses and surface an error envelope. We just split on commas and trim.
// CC and BCC default to collapsed; "+ Add Cc / Bcc" toggles reveal them.
// =============================================================================

import { useState } from "react";

interface RecipientsFieldsProps {
  to: string[];
  cc: string[];
  bcc: string[];
  onChange: (next: { to: string[]; cc: string[]; bcc: string[] }) => void;
  disabled?: boolean;
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function RecipientsFields({
  to,
  cc,
  bcc,
  onChange,
  disabled = false,
}: RecipientsFieldsProps) {
  const [showCc, setShowCc] = useState(cc.length > 0);
  const [showBcc, setShowBcc] = useState(bcc.length > 0);

  return (
    <div className="flex flex-col gap-2">
      <Field
        id="compose-to"
        label="To"
        value={to.join(", ")}
        onChange={(v) => onChange({ to: parseList(v), cc, bcc })}
        disabled={disabled}
        testId="compose-to"
      />

      {showCc ? (
        <Field
          id="compose-cc"
          label="Cc"
          value={cc.join(", ")}
          onChange={(v) => onChange({ to, cc: parseList(v), bcc })}
          disabled={disabled}
          testId="compose-cc"
        />
      ) : null}

      {showBcc ? (
        <Field
          id="compose-bcc"
          label="Bcc"
          value={bcc.join(", ")}
          onChange={(v) => onChange({ to, cc, bcc: parseList(v) })}
          disabled={disabled}
          testId="compose-bcc"
        />
      ) : null}

      <div className="flex gap-3 text-xs">
        {!showCc && (
          <button
            type="button"
            onClick={() => setShowCc(true)}
            data-testid="add-cc"
            disabled={disabled}
            className="text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            + Add Cc
          </button>
        )}
        {!showBcc && (
          <button
            type="button"
            onClick={() => setShowBcc(true)}
            data-testid="add-bcc"
            disabled={disabled}
            className="text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            + Add Bcc
          </button>
        )}
      </div>
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  testId: string;
}

function Field({ id, label, value, onChange, disabled, testId }: FieldProps) {
  return (
    <div className="flex items-baseline gap-2">
      <label
        htmlFor={id}
        className="w-10 shrink-0 text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      <input
        id={id}
        data-testid={testId}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="comma-separated emails"
        className={[
          "flex-1 rounded border border-input bg-background px-2 py-1 text-sm",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          disabled ? "opacity-50" : "",
        ].join(" ")}
      />
    </div>
  );
}
