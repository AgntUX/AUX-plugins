/**
 * LicenseErrorScreen — full-surface error envelope renderer.
 *
 * Author: AgntUX
 * License: Apache-2.0
 *
 * Used at the top of `App.tsx` to short-circuit rendering when a tool-level
 * error envelope reaches the iframe. Renders the entire `text` field with
 * `whitespace-pre-wrap` so multi-paragraph messages survive intact.
 *
 * Pair with `detectErrorEnvelope(toolOutput)` to decide when to render this.
 */

export interface LicenseErrorScreenProps {
  /** The full error text from `_content[0].text`. Rendered as-is. */
  message: string;
}

export function LicenseErrorScreen({ message }: LicenseErrorScreenProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 text-base font-semibold text-neutral-900 dark:text-neutral-100">
          This view can&apos;t load right now
        </h2>
        <p className="whitespace-pre-wrap break-words text-sm text-neutral-700 dark:text-neutral-300">
          {message}
        </p>
      </div>
    </div>
  );
}
