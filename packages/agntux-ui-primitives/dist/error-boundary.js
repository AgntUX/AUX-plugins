import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { Component } from "react";
export class ComponentErrorBoundary extends Component {
    state = { error: null, retryKey: 0 };
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        this.props.onError?.(error, info);
        // Surface to console for local debugging — host loggers wrap console.
        console.error("[ComponentErrorBoundary] render error:", error, info);
    }
    handleRetry = () => {
        this.setState((prev) => ({ error: null, retryKey: prev.retryKey + 1 }));
    };
    render() {
        const { error, retryKey } = this.state;
        const { children, fallback } = this.props;
        if (error) {
            if (fallback)
                return fallback(error, this.handleRetry);
            return (_jsxs("div", { role: "alert", className: "flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center", "data-testid": "component-error-boundary", children: [_jsx("div", { className: "text-base font-semibold text-foreground", children: "Something went wrong" }), _jsx("p", { className: "max-w-sm text-sm text-muted-foreground", children: error.message || "The component crashed while rendering." }), _jsx("button", { type: "button", onClick: this.handleRetry, className: "rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-card-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring", children: "Retry" })] }));
        }
        // Key reset on retry forces React to unmount + re-mount the subtree, which
        // clears whatever broken internal state caused the throw.
        return _jsx("div", { children: children }, retryKey);
    }
}
