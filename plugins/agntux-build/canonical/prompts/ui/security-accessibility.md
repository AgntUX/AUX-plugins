# Security & Accessibility

## Security & Accessibility (Summary)

**Security:**
- Never store passwords, API keys, or sensitive PII in widgetState
- Validate all inputs - assume malicious input will reach server
- Sanitize user input before storing

**Accessibility (WCAG AA Mandatory):**
- All interactive elements must have ARIA labels
- Keyboard navigation required for all features
- Color contrast must meet WCAG AA standards
- Use semantic HTML (button, nav, main, etc.)

## Security Requirements

**Core Principles:**
- Least privilege - Only request necessary permissions
- Explicit user consent - Users understand when granting access
- Defense in depth - Assume prompt injection and malicious inputs

**Data Handling:**
- **Never store in widgetState**: Passwords, API keys, secrets, sensitive PII (SSN, credit cards, etc.)
- **Validate all inputs** - Assume malicious input will reach server
- **Sanitize user input** before storing in widgetState
- **Check for sensitive data** before storing in widgetState

**Input Validation:**
- Validate email, URL, number ranges, string lengths
- Sanitize strings to prevent XSS attacks
- Never trust client-side validation alone - server must validate

**Authentication:**
- If OAuth required, follow OAuth 2.1 with PKCE
- Verify tokens on every request
- Handle authentication errors gracefully
- Return `_meta["mcp/www_authenticate"]` in error responses to trigger OAuth flow

**Content Security Policy (CSP):**
- Define `_meta.ui.csp` in resource registration
- `connectDomains`: Domains widget can fetch from
- `resourceDomains`: Domains for static assets
- `frameDomains`: Optional iframe origins (discouraged, higher scrutiny)

**Iframe Sandbox Restrictions:**
MCP Apps run in sandboxed iframes. Many standard browser APIs are blocked or restricted:

- **File downloads — NOT SUPPORTED**: `pdf.save()`, `<a download>.click()`, blob URL downloads, and data URL downloads are ALL blocked. `client.openLink()` with data URLs also silently fails on most hosts. `window.print()` is blocked (sandbox lacks `allow-modals`). **File downloads from MCP Apps are not currently supported.** The `ui/download-file` method exists in the draft MCP Apps spec but is not yet implemented by any host (as of March 2026). Do NOT include file download features (PDF export, CSV export, etc.) in component designs. Do NOT use html2canvas, jsPDF, or any PDF/file generation libraries.
- **External links — `<a href>` DOES NOT WORK**: Standard anchor tags, `window.open()`, and `location.href` are ALL blocked by the iframe sandbox. Links will silently fail. Instead, use the host API:
  ```typescript
  const client = useAppsClient();
  await client.openLink('https://example.com'); // HTTPS only
  ```
  Render clickable elements as `<button>` styled as links, not `<a>` tags. Data URLs and blob URLs are not supported.
- **Clipboard**: `navigator.clipboard` may not be available. Instead: render text in a selectable element for manual copy.
- **Permission-gated APIs** (geolocation, notifications, camera): Not available in sandboxed iframes. Design UX that doesn't require them.

General rule: if a browser API requires elevated permissions or spawns UI outside the page (downloads, popups, permission prompts), it won't work in the sandbox. The only reliable host APIs are `openLink` (HTTPS URLs only), `sendFollowUpMessage`, and `callTool`.

Always wrap operations that modify UI state in try/finally:
```typescript
// Hide elements, show spinners, etc. BEFORE try
setLoading(true);
try {
  await expensiveOperation();
} catch (error) {
  console.error('Operation failed:', error);
} finally {
  setLoading(false);  // ALWAYS restore UI state
}
```

---

## Accessibility Requirements (WCAG AA Mandatory)

**Core Requirements:**
- WCAG AA compliance is mandatory
- All interactive elements must have ARIA labels
- Keyboard navigation must work for all features
- Screen reader support required
- Text must resize without breaking layouts

**Implementation:**
- Use semantic HTML: `<button>`, `<nav>`, `<main>`, `<article>`, etc.
- Add ARIA labels: `aria-label`, `aria-labelledby`, `aria-describedby`
- Provide alt text for all images
- Ensure color contrast meets WCAG AA standards
- Test with screen readers (VoiceOver, NVDA, JAWS)

**Keyboard Navigation:**
- All interactive elements must be focusable
- Tab order must be logical
- Focus indicators must be visible
- Escape key should close modals/dropdowns
