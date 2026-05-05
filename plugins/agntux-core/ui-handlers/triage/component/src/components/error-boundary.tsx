/**
 * ComponentErrorBoundary — render-error containment with retry.
 *
 * Author: AgntUX
 * License: ELv2
 *
 * Wraps the component subtree to catch render-time exceptions (the kind React
 * cannot recover from on its own) and present a degraded "Something went
 * wrong" surface with a Retry button. Retry re-mounts children by bumping a
 * `retryKey` — this discards any internal state in the broken subtree and
 * re-runs effects from scratch.
 *
 * Use as the outermost wrapper inside `App.tsx`, BELOW protocol providers
 * (so the boundary itself can call protocol hooks safely if needed) and
 * ABOVE the main component so it catches everything user code can throw.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ComponentErrorBoundaryProps {
  /** The subtree to protect. Re-mounted on Retry via key reset. */
  children: ReactNode;
  /** Optional fallback override. If omitted, uses the built-in surface. */
  fallback?: (error: Error, retry: () => void) => ReactNode;
  /** Optional sink for error reporting (e.g. host telemetry). */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ComponentErrorBoundaryState {
  error: Error | null;
  retryKey: number;
}

export class ComponentErrorBoundary extends Component<
  ComponentErrorBoundaryProps,
  ComponentErrorBoundaryState
> {
  state: ComponentErrorBoundaryState = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<ComponentErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    // Surface to console for local debugging — host loggers wrap console.
    // eslint-disable-next-line no-console
    console.error('[ComponentErrorBoundary] render error:', error, info);
  }

  private handleRetry = (): void => {
    this.setState((prev) => ({ error: null, retryKey: prev.retryKey + 1 }));
  };

  render(): ReactNode {
    const { error, retryKey } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      if (fallback) return fallback(error, this.handleRetry);
      return (
        <div
          role="alert"
          className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center"
          data-testid="component-error-boundary"
        >
          <div className="text-base font-semibold text-foreground">
            Something went wrong
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            {error.message || 'The component crashed while rendering.'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-card-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        </div>
      );
    }

    // Key reset on retry forces React to unmount + re-mount the subtree, which
    // clears whatever broken internal state caused the throw.
    return <div key={retryKey}>{children}</div>;
  }
}
