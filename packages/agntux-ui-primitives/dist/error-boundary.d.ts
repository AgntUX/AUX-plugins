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
import { Component, type ErrorInfo, type ReactNode } from "react";
export interface ComponentErrorBoundaryProps {
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
export declare class ComponentErrorBoundary extends Component<ComponentErrorBoundaryProps, ComponentErrorBoundaryState> {
    state: ComponentErrorBoundaryState;
    static getDerivedStateFromError(error: Error): Partial<ComponentErrorBoundaryState>;
    componentDidCatch(error: Error, info: ErrorInfo): void;
    private handleRetry;
    render(): ReactNode;
}
export {};
