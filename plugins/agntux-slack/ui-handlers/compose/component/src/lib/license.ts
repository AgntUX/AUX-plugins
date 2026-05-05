/**
 * Render-token verification + gate evaluation for the AgntUX license gate.
 *
 * P2a / T09 deliverable. The iframe refuses to mount <MainComponent>
 * without a verifiable render token. The token is signed by AgntUX KMS
 * (Ed25519, kid=agntux-render-v1, aud=mcp-app-iframe, iss=https://agntux.ai).
 *
 * jose import discipline: pull only `importSPKI` and `jwtVerify` — pulling
 * the full `jose` namespace inflates the bundle past the 200 KB target.
 *
 * Threat model + claim layout: see ~/.claude/plans/p2a-ui-component-license-gating.md
 * §2.2 (claims), §6.2 (failure reasons), §9 (threats).
 */

import { importSPKI, jwtVerify } from 'jose';

// ---------------------------------------------------------------------------
// Build-time public key substitution
// ---------------------------------------------------------------------------

/**
 * Render-token public key (Ed25519 SPKI/PEM).
 *
 * - kid: agntux-render-v1
 * - aud: mcp-app-iframe
 * - iss: https://agntux.ai
 *
 * Source of truth: ~/.claude/plans/p2-fixtures/kms-public-keys.json.
 *
 * Build-time substitution: the plugin generator (P4 generator amendment)
 * may overwrite this constant, or callers may set `VITE_PUBLIC_KEY_RENDER_SPKI_PEM`
 * to override at build. Tests inject their own key via the optional
 * `publicKeyPem` parameter on `verifyRenderToken`.
 *
 * substituted at build by T13
 */
export const PUBLIC_KEY_RENDER_SPKI_PEM: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string | undefined> }).env
      ?.VITE_PUBLIC_KEY_RENDER_SPKI_PEM) ||
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAFGzWfy8wMeEIEpUh7ssswmDXkU5JtxOclwvDx8qlIBM=
-----END PUBLIC KEY-----`;

/** kid baked into the bundle. Tokens with any other kid are rejected. */
export const RENDER_KID = 'agntux-render-v1';
/** Required audience claim. */
export const RENDER_AUD = 'mcp-app-iframe';
/** Required issuer claim. */
export const RENDER_ISS = 'https://agntux.ai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RenderPlan = 'paid' | 'trial' | 'expired';

/**
 * Subset of JWT claims the iframe gate cares about (P2a §2.2).
 *
 * `trial_expires_at` is null on `paid`/`expired` plans.
 */
export interface RenderTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  plan: RenderPlan;
  trial_expires_at: number | null;
  kid?: string;
}

export type VerifyFailureReason =
  | 'missing'
  | 'invalid-signature'
  | 'wrong-audience'
  | 'wrong-issuer'
  | 'tampered-claim'
  | 'unknown-kid'
  | 'expired';

export type VerifyResult =
  | { ok: true; payload: RenderTokenClaims }
  | { ok: false; reason: VerifyFailureReason };

export type GateOutcome = 'paid' | 'trial' | 'trial-expired' | 'blocked';

export interface BlockedDetail {
  reason: VerifyFailureReason | 'trial-expired' | 'plan-expired';
}

// ---------------------------------------------------------------------------
// verifyRenderToken
// ---------------------------------------------------------------------------

interface VerifyOptions {
  /** Override the bundled SPKI/PEM public key. Test-only. */
  publicKeyPem?: string;
  /** Override the expected kid. Test-only. */
  kid?: string;
  /** Override the current time (epoch seconds). Test-only. */
  now?: number;
}

/**
 * Verify a render token's signature and required claims.
 *
 * Returns a discriminated union — `{ ok: true, payload }` on success,
 * `{ ok: false, reason }` on any failure. Never throws.
 *
 * Failure precedence (matters for tests + observability):
 *   1. missing token              → `missing`
 *   2. signature/header bad       → `invalid-signature`
 *   3. unknown kid                → `unknown-kid`
 *   4. wrong audience             → `wrong-audience`
 *   5. wrong issuer               → `wrong-issuer`
 *   6. missing/invalid claims     → `tampered-claim`
 *   7. expired (now > exp)        → `expired`  (zero-grace per P2.AMEND.3)
 */
export async function verifyRenderToken(
  token: string | undefined | null,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  if (!token || typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'missing' };
  }

  // Decode the protected header without verifying so we can fail fast on
  // unknown kids before doing the (more expensive) Ed25519 verify.
  let headerKid: string | undefined;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { ok: false, reason: 'invalid-signature' };
    }
    const headerJson = base64UrlDecode(parts[0]);
    const header = JSON.parse(headerJson) as { kid?: string; alg?: string };
    headerKid = header.kid;
  } catch {
    return { ok: false, reason: 'invalid-signature' };
  }

  const expectedKid = options.kid ?? RENDER_KID;
  if (headerKid && headerKid !== expectedKid) {
    return { ok: false, reason: 'unknown-kid' };
  }

  // Import the SPKI/PEM public key. jose is strict — invalid PEM throws.
  let key: Awaited<ReturnType<typeof importSPKI>>;
  try {
    key = await importSPKI(
      options.publicKeyPem ?? PUBLIC_KEY_RENDER_SPKI_PEM,
      'EdDSA',
    );
  } catch {
    return { ok: false, reason: 'invalid-signature' };
  }

  // Verify signature + standard claims. We pass `currentDate` only when the
  // caller overrode `now` (tests); otherwise jose uses Date.now().
  let claims: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, key, {
      // Don't enforce aud/iss here — we want fine-grained reasons for the
      // gate. Check them ourselves below.
      algorithms: ['EdDSA'],
      currentDate:
        typeof options.now === 'number'
          ? new Date(options.now * 1000)
          : undefined,
    });
    claims = verified.payload as Record<string, unknown>;
  } catch (err) {
    // jose throws JWTExpired for expired tokens — propagate as `expired`.
    const code = (err as { code?: string } | null)?.code;
    if (code === 'ERR_JWT_EXPIRED') {
      return { ok: false, reason: 'expired' };
    }
    return { ok: false, reason: 'invalid-signature' };
  }

  // Audience check (do this BEFORE issuer + plan/exp so a wrong-aud token
  // produced for some other surface fails closed with a precise reason).
  if (claims.aud !== RENDER_AUD) {
    return { ok: false, reason: 'wrong-audience' };
  }
  if (claims.iss !== RENDER_ISS) {
    return { ok: false, reason: 'wrong-issuer' };
  }

  // Plan + exp + sub claim shape.
  const plan = claims.plan;
  if (plan !== 'paid' && plan !== 'trial' && plan !== 'expired') {
    return { ok: false, reason: 'tampered-claim' };
  }
  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') {
    return { ok: false, reason: 'tampered-claim' };
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    return { ok: false, reason: 'tampered-claim' };
  }

  // Zero-grace expiry. jose's currentDate handling is inclusive; we mirror
  // the explicit check here for the override case where a test sets
  // `options.now > exp` directly.
  const now =
    typeof options.now === 'number'
      ? options.now
      : Math.floor(Date.now() / 1000);
  if (now > (claims.exp as number)) {
    return { ok: false, reason: 'expired' };
  }

  // trial_expires_at: number for trial, null/absent for paid/expired.
  const trialExpiresAt =
    typeof claims.trial_expires_at === 'number'
      ? (claims.trial_expires_at as number)
      : null;

  return {
    ok: true,
    payload: {
      iss: claims.iss as string,
      aud: claims.aud as string,
      sub: claims.sub as string,
      iat: claims.iat as number,
      exp: claims.exp as number,
      plan: plan as RenderPlan,
      trial_expires_at: trialExpiresAt,
      kid: headerKid,
    },
  };
}

// ---------------------------------------------------------------------------
// evaluateGate
// ---------------------------------------------------------------------------

/**
 * Pure mapping from verified claims to gate outcome.
 *
 *   - paid          → render MainComponent unchanged
 *   - trial         → render TrialBanner + MainComponent
 *   - trial-expired → render TrialExpiredScreen
 *   - blocked       → render LicenseRequiredScreen
 *
 * Zero-grace per P2a.AMEND.3: `now > exp` is `blocked`, no exceptions.
 */
export function evaluateGate(
  payload: RenderTokenClaims | null | undefined,
  now: number,
): GateOutcome {
  if (!payload) return 'blocked';

  // Re-check exp here in case caller skipped verifyRenderToken's exp check.
  if (now > payload.exp) return 'blocked';

  // plan === 'expired' → trial-expired screen, regardless of trial_expires_at.
  if (payload.plan === 'expired') return 'trial-expired';

  if (payload.plan === 'trial') {
    if (
      typeof payload.trial_expires_at === 'number' &&
      now >= payload.trial_expires_at
    ) {
      return 'trial-expired';
    }
    return 'trial';
  }

  if (payload.plan === 'paid') return 'paid';

  return 'blocked';
}

/**
 * Days remaining in the trial. Always >= 0. Returns 0 on the last day.
 */
export function trialDaysRemaining(
  payload: RenderTokenClaims,
  now: number,
): number {
  if (payload.trial_expires_at === null) return 0;
  const seconds = payload.trial_expires_at - now;
  if (seconds <= 0) return 0;
  return Math.ceil(seconds / 86400);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function base64UrlDecode(str: string): string {
  // Pad to multiple of 4 + convert URL-safe chars.
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const normal = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  // atob is available in jsdom + the iframe browser sandbox.
  if (typeof atob === 'function') {
    return atob(normal);
  }
  // Node fallback for tooling/SSR — Buffer is not available in the iframe.
  return Buffer.from(normal, 'base64').toString('binary');
}
