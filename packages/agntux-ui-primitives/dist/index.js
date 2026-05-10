/**
 * @agntux/ui-primitives — shared React primitives for AgntUX UI handlers.
 *
 * Author: AgntUX
 * License: Apache-2.0
 *
 * Every primitive here is consumed by every UI-handler component bundle in
 * this marketplace. Add a new export only when at least two handlers need
 * the same code; one-off helpers live next to their caller.
 */
export { AgntuxLogo } from "./agntux-logo.js";
export { ComponentErrorBoundary, } from "./error-boundary.js";
export { ServerErrorScreen, } from "./server-error-screen.js";
export { ScrollablePanel, } from "./scrollable-panel.js";
export { Spinner } from "./spinner.js";
export { detectErrorEnvelope } from "./detect-error-envelope.js";
export { daysSince, formatTime, safeArray, safeBoolean, safeDate, safeEnum, safeNumber, safeObject, safeString, } from "./safe-accessors.js";
