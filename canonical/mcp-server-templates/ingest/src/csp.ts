// CSP _meta builder — mirrors the orchestrator template (P4 §6.8).
// Ingest plugin UI bundles are single-file Vite output (styles + scripts inlined
// into the HTML); no external requests are needed.
export function buildCSP(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
