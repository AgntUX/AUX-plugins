// =============================================================================
// email-context-disclosure.tsx — collapsible "Prior conversations" disclosure.
//
// Shows the synthesised email-context preamble the sync skill wrote to the
// action's `## Email context` body section in Step 10.2. Surfaced as a <details>
// element collapsed by default. Empty body → don't render.
// =============================================================================

interface EmailContextDisclosureProps {
  context: string;
}

export function EmailContextDisclosure({ context }: EmailContextDisclosureProps) {
  const trimmed = context.trim();
  if (!trimmed) return null;

  return (
    <details
      data-testid="email-context-disclosure"
      className="rounded border border-border text-sm"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        Prior conversations with this person
      </summary>
      <div className="px-3 pb-3 pt-1">
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
          {trimmed}
        </p>
      </div>
    </details>
  );
}
