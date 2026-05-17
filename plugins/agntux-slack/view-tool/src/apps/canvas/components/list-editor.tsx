// =============================================================================
// list-editor.tsx — generic add/remove row editor for decisions and
// open_questions lists.
// =============================================================================

interface ListEditorProps {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  maxItems?: number;
  disabled?: boolean;
  testIdPrefix?: string;
}

/**
 * ListEditor — renders a list of text inputs with add/remove affordances.
 * Each row is a plain text input; add-row appends an empty string; remove-row
 * filters the item out by index.
 */
export function ListEditor({
  label,
  items,
  onChange,
  placeholder = "Add item…",
  maxItems = 8,
  disabled = false,
  testIdPrefix = "list-editor",
}: ListEditorProps) {
  function handleChange(index: number, value: string) {
    const next = items.map((item, i) => (i === index ? value : item));
    onChange(next);
  }

  function handleRemove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function handleAdd() {
    if (items.length >= maxItems) return;
    onChange([...items, ""]);
  }

  return (
    <div className="flex flex-col gap-1" data-testid={testIdPrefix}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {items.length < maxItems && (
          <button
            type="button"
            data-testid={`${testIdPrefix}-add`}
            onClick={handleAdd}
            disabled={disabled}
            className="text-xs text-primary hover:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            + Add
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              type="text"
              aria-label={`${label} item ${i + 1}`}
              data-testid={`${testIdPrefix}-item-${i}`}
              value={item}
              placeholder={placeholder}
              disabled={disabled}
              onChange={(e) => handleChange(i, e.target.value)}
              className={[
                "flex-1 rounded border border-input bg-background px-2 py-1 text-sm",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                disabled ? "opacity-50" : "",
              ].join(" ")}
            />
            <button
              type="button"
              aria-label={`Remove ${label} item ${i + 1}`}
              data-testid={`${testIdPrefix}-remove-${i}`}
              onClick={() => handleRemove(i)}
              disabled={disabled}
              className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              ×
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No items yet.</p>
        )}
      </div>
    </div>
  );
}
