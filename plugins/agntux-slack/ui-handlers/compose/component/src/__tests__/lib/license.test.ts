/**
 * Unit tests for src/lib/license.ts
 *
 * Covers all 11 scenarios required by T09 / P2a §8.3:
 *  1. Paid — verifyRenderToken ok, evaluateGate → "paid"
 *  2. Trial — evaluateGate → "trial", correct days
 *  3. Trial-expired — evaluateGate → "trial-expired" when trial_expires_at past
 *  4. Missing token → reason: "missing"
 *  5. Tampered signature → reason: "invalid-signature"
 *  6. Wrong aud → reason: "wrong-audience"
 *  7. Wrong iss → reason: "wrong-issuer"
 *  8. now > exp (zero-grace) → reason: "expired"
 *  9. Unknown kid → reason: "unknown-kid"
 * 10. plan: "expired" → evaluateGate → "trial-expired"
 * 11. evaluateGate blocked when payload is null
 *
 * Signing: pure Node crypto (sign(null, data, privateKey)) — avoids the
 * jsdom/SubtleCrypto gap where jose's browser bundle can't sign with Ed25519.
 * Production render PEM is NEVER used here.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, sign, KeyObject } from 'crypto';
import {
  verifyRenderToken,
  evaluateGate,
  trialDaysRemaining,
  RENDER_AUD,
  RENDER_ISS,
  RENDER_KID,
} from '../../lib/license.js';

// ---------------------------------------------------------------------------
// Test keypair + native JWT signing
// ---------------------------------------------------------------------------

let testPublicKeyPem: string;
let testPrivateKey: KeyObject;

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  testPublicKeyPem = publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  testPrivateKey = privateKey;
});

function b64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64url');
}

/**
 * Build a real EdDSA JWT signed with the test private key.
 * Uses Node's native `crypto.sign(null, data, key)` — no SubtleCrypto.
 */
function makeToken(
  claims: Record<string, unknown>,
  kid: string = RENDER_KID,
): string {
  const header = b64url(JSON.stringify({ alg: 'EdDSA', kid }));
  const payload = b64url(JSON.stringify(claims));
  const data = Buffer.from(`${header}.${payload}`);
  const sig = sign(null, data, testPrivateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000;
const EXP = NOW + 86_400;

function baseClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: RENDER_ISS,
    aud: RENDER_AUD,
    sub: 'usr_test123',
    iat: NOW,
    exp: EXP,
    plan: 'paid',
    trial_expires_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// verifyRenderToken
// ---------------------------------------------------------------------------

describe('verifyRenderToken', () => {
  // Case 4: missing token
  it('returns reason:missing for undefined token', async () => {
    const result = await verifyRenderToken(undefined, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing');
  });

  it('returns reason:missing for empty string', async () => {
    const result = await verifyRenderToken('', { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing');
  });

  // Case 5: tampered signature
  it('returns reason:invalid-signature for tampered token', async () => {
    const token = makeToken(baseClaims());
    const parts = token.split('.');
    const sig = parts[2];
    const tampered = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    const tamperedToken = `${parts[0]}.${parts[1]}.${tampered}`;
    const result = await verifyRenderToken(tamperedToken, {
      publicKeyPem: testPublicKeyPem,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-signature');
  });

  // Case 6: wrong aud
  it('returns reason:wrong-audience for wrong aud claim', async () => {
    const token = makeToken(baseClaims({ aud: 'wrong-audience' }));
    const result = await verifyRenderToken(token, {
      publicKeyPem: testPublicKeyPem,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong-audience');
  });

  // Case 7: wrong iss
  it('returns reason:wrong-issuer for wrong iss claim', async () => {
    const token = makeToken(baseClaims({ iss: 'https://evil.example.com' }));
    const result = await verifyRenderToken(token, {
      publicKeyPem: testPublicKeyPem,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong-issuer');
  });

  // Case 8: expired token (zero-grace)
  it('returns reason:expired when now > exp', async () => {
    const token = makeToken(baseClaims({ exp: NOW - 1 }));
    const result = await verifyRenderToken(token, {
      publicKeyPem: testPublicKeyPem,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('returns reason:expired even 1 second past exp', async () => {
    const token = makeToken(baseClaims({ exp: NOW }));
    const result = await verifyRenderToken(token, {
      publicKeyPem: testPublicKeyPem,
      now: NOW + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  // Case 9: unknown kid
  it('returns reason:unknown-kid for unrecognised kid in header', async () => {
    const token = makeToken(baseClaims(), 'agntux-render-unknown');
    const result = await verifyRenderToken(token, {
      publicKeyPem: testPublicKeyPem,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown-kid');
  });

  // Case 1: paid — happy path
  it('returns ok:true with paid payload for a valid paid token', async () => {
    const token = makeToken(baseClaims());
    const result = await verifyRenderToken(token, {
      publicKeyPem: testPublicKeyPem,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.plan).toBe('paid');
      expect(result.payload.aud).toBe(RENDER_AUD);
      expect(result.payload.iss).toBe(RENDER_ISS);
      expect(result.payload.exp).toBe(EXP);
      expect(result.payload.sub).toBe('usr_test123');
    }
  });

  // Case 2: trial — happy path
  it('returns ok:true with trial payload and trial_expires_at', async () => {
    const trialExp = NOW + 14 * 86_400;
    const token = makeToken(
      baseClaims({ plan: 'trial', trial_expires_at: trialExp }),
    );
    const result = await verifyRenderToken(token, {
      publicKeyPem: testPublicKeyPem,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.plan).toBe('trial');
      expect(result.payload.trial_expires_at).toBe(trialExp);
    }
  });

  // tampered claim: missing sub
  it('returns reason:tampered-claim when sub is missing', async () => {
    const claims = { ...baseClaims() };
    delete (claims as Record<string, unknown>).sub;
    const token = makeToken(claims);
    const result = await verifyRenderToken(token, {
      publicKeyPem: testPublicKeyPem,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('tampered-claim');
  });
});

// ---------------------------------------------------------------------------
// evaluateGate
// ---------------------------------------------------------------------------

describe('evaluateGate', () => {
  // Case 1: paid → "paid"
  it('returns paid for a valid paid payload', () => {
    expect(
      evaluateGate(
        {
          iss: RENDER_ISS,
          aud: RENDER_AUD,
          sub: 'u1',
          iat: NOW,
          exp: EXP,
          plan: 'paid',
          trial_expires_at: null,
        },
        NOW,
      ),
    ).toBe('paid');
  });

  // Case 2: trial with days remaining → "trial"
  it('returns trial for plan:trial with future trial_expires_at', () => {
    expect(
      evaluateGate(
        {
          iss: RENDER_ISS,
          aud: RENDER_AUD,
          sub: 'u1',
          iat: NOW,
          exp: EXP,
          plan: 'trial',
          trial_expires_at: NOW + 5 * 86_400,
        },
        NOW,
      ),
    ).toBe('trial');
  });

  // Case 3: trial with trial_expires_at in the past → "trial-expired"
  it('returns trial-expired when trial_expires_at is past', () => {
    expect(
      evaluateGate(
        {
          iss: RENDER_ISS,
          aud: RENDER_AUD,
          sub: 'u1',
          iat: NOW,
          exp: EXP,
          plan: 'trial',
          trial_expires_at: NOW - 1,
        },
        NOW,
      ),
    ).toBe('trial-expired');
  });

  // Case 10: plan: "expired" → "trial-expired" screen
  it('returns trial-expired for plan:expired', () => {
    expect(
      evaluateGate(
        {
          iss: RENDER_ISS,
          aud: RENDER_AUD,
          sub: 'u1',
          iat: NOW,
          exp: EXP,
          plan: 'expired',
          trial_expires_at: null,
        },
        NOW,
      ),
    ).toBe('trial-expired');
  });

  // Case 8: now > exp (zero-grace) → "blocked"
  it('returns blocked when now > exp regardless of plan', () => {
    expect(
      evaluateGate(
        {
          iss: RENDER_ISS,
          aud: RENDER_AUD,
          sub: 'u1',
          iat: NOW,
          exp: NOW - 1,
          plan: 'paid',
          trial_expires_at: null,
        },
        NOW,
      ),
    ).toBe('blocked');
  });

  // Case 11: null payload → "blocked"
  it('returns blocked for null payload', () => {
    expect(evaluateGate(null, NOW)).toBe('blocked');
  });

  it('returns blocked for undefined payload', () => {
    expect(evaluateGate(undefined, NOW)).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// trialDaysRemaining
// ---------------------------------------------------------------------------

describe('trialDaysRemaining', () => {
  it('returns ceil of days remaining', () => {
    const payload = {
      iss: RENDER_ISS,
      aud: RENDER_AUD,
      sub: 'u1',
      iat: NOW,
      exp: EXP,
      plan: 'trial' as const,
      trial_expires_at: NOW + 5 * 86_400 + 1,
    };
    expect(trialDaysRemaining(payload, NOW)).toBe(6);
  });

  it('returns 0 when trial_expires_at is in the past', () => {
    const payload = {
      iss: RENDER_ISS,
      aud: RENDER_AUD,
      sub: 'u1',
      iat: NOW,
      exp: EXP,
      plan: 'trial' as const,
      trial_expires_at: NOW - 100,
    };
    expect(trialDaysRemaining(payload, NOW)).toBe(0);
  });

  it('returns 0 when trial_expires_at is null', () => {
    const payload = {
      iss: RENDER_ISS,
      aud: RENDER_AUD,
      sub: 'u1',
      iat: NOW,
      exp: EXP,
      plan: 'paid' as const,
      trial_expires_at: null,
    };
    expect(trialDaysRemaining(payload, NOW)).toBe(0);
  });
});
