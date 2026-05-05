// =============================================================================
// mode-tabs.tsx — segmented control for Send now / Schedule / Save Slack draft.
// =============================================================================

import type { InitialVerb } from "../lib/types.js";

export type ComposeMode = InitialVerb;

interface ModeTabsProps {
  value: ComposeMode;
  onChange: (mode: ComposeMode) => void;
  disabled?: boolean;
}

const TABS: { value: ComposeMode; label: string }[] = [
  { value: "draft", label: "Send now" },
  { value: "schedule", label: "Schedule" },
  { value: "save_draft", label: "Save as draft" },
];

export function ModeTabs({ value, onChange, disabled = false }: ModeTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Reply mode"
      data-testid="mode-tabs"
      className="flex gap-1 rounded-md border border-border bg-muted p-1"
    >
      {TABS.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          type="button"
          aria-selected={value === tab.value}
          data-testid={`mode-tab-${tab.value}`}
          disabled={disabled}
          onClick={() => onChange(tab.value)}
          className={[
            "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === tab.value
              ? "bg-card text-card-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          ].join(" ")}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
