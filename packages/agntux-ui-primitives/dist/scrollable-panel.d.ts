/**
 * ScrollablePanel — primitive layout: sticky header + scrollable body + sticky footer.
 *
 * Author: AgntUX
 * License: ELv2
 *
 * Use this for any inline-iframe screen that needs to keep its title visible
 * at the top, scroll its body, and keep its primary action visible at the
 * bottom.
 *
 * The optional `onHelpClick` renders a small help button in the header. The
 * caller wires the actual deep-link dispatch (e.g. via host `openLink`); this
 * primitive intentionally has no apps-client dependency.
 */
import type { ReactNode } from "react";
export interface ScrollablePanelProps {
    /** Header title — string or rich node. */
    title: ReactNode;
    /** Called when the user clicks the dismiss button. Omit to hide the button. */
    onDismiss?: () => void;
    /**
     * Called when the user clicks the help button. Omit to hide the button. The
     * caller is responsible for actually opening the link via the host's
     * `openLink` API (or however they want to deep-link).
     */
    onHelpClick?: () => void;
    /** Aria-label for the help button. Defaults to "Help". */
    helpLabel?: string;
    /** Body content — typically the form/list/details for this view. */
    children: ReactNode;
    /** Sticky footer content (e.g. Cancel / Save / Send buttons). Optional. */
    footer?: ReactNode;
}
export declare function ScrollablePanel({ title, onDismiss, onHelpClick, helpLabel, children, footer, }: ScrollablePanelProps): import("react/jsx-runtime").JSX.Element;
