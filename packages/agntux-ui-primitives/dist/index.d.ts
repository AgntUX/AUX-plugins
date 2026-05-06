/**
 * @agntux/ui-primitives — shared React primitives for AgntUX UI handlers.
 *
 * Author: AgntUX
 * License: ELv2
 *
 * Every primitive here is consumed by every UI-handler component bundle in
 * this marketplace. Add a new export only when at least two handlers need
 * the same code; one-off helpers live next to their caller.
 */
export { AgntuxLogo, type AgntuxLogoProps } from "./agntux-logo.js";
export { ComponentErrorBoundary, type ComponentErrorBoundaryProps, } from "./error-boundary.js";
export { LicenseErrorScreen, type LicenseErrorScreenProps, } from "./license-error-screen.js";
export { ScrollablePanel, type ScrollablePanelProps, } from "./scrollable-panel.js";
export { Spinner, type SpinnerProps } from "./spinner.js";
export { detectErrorEnvelope } from "./detect-error-envelope.js";
export { daysSince, formatTime, safeArray, safeBoolean, safeDate, safeEnum, safeNumber, safeObject, safeString, } from "./safe-accessors.js";
