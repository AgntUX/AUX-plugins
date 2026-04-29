export function buildCSP(): string {
  // Match what AgntUX's S3-hosted UI bundles expect. Single-file inlined Vite output:
  // styles + scripts inlined into the HTML, no external requests.
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
