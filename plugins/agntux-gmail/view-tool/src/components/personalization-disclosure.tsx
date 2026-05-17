// =============================================================================
// personalization-disclosure.tsx — collapsible "Why this draft?" bullet list.
// =============================================================================

interface PersonalizationDisclosureProps {
  signals: string[];
}

/**
 * PersonalizationDisclosure — shows the personalization signals as a
 * collapsible <details> element so the user can trust the draft without
 * cluttering the primary compose area.
 */
export function PersonalizationDisclosure({
  signals,
}: PersonalizationDisclosureProps) {
  if (signals.length === 0) return null;

  return (
    <details
      data-testid="personalization-disclosure"
      className="rounded border border-border text-sm"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        Why this draft?
      </summary>
      <ul className="px-3 pb-3 pt-1 space-y-1 list-disc list-inside">
        {signals.map((signal, i) => (
          <li
            key={i}
            data-testid={`personalization-signal-${i}`}
            className="text-xs text-muted-foreground"
          >
            {signal}
          </li>
        ))}
      </ul>
    </details>
  );
}
