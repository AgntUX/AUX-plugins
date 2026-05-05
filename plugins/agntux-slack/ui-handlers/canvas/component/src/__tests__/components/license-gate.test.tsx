/**
 * Component-level tests for <LicenseGate> (T09 / P2a §8.3).
 *
 * Signing: pure Node crypto (sign(null, data, privateKey)) — avoids the
 * jsdom/SubtleCrypto gap where jose's browser bundle can't sign Ed25519.
 * Production render PEM is NEVER used here.
 *
 * Cases covered (11 required by kickoff):
 *  1. Paid  — children render, no banner, no notifications
 *  2. Trial — TrialBanner + children
 *  3. Trial-expired — TrialExpiredScreen only
 *  4. Blocked: missing token
 *  5. Blocked: tampered signature
 *  6. Blocked: wrong aud
 *  7. Blocked: wrong iss
 *  8. Blocked: now > exp (zero-grace)
 *  9. Blocked: unknown kid
 * 10. Dev-mode bypass — banner shown, children render
 * 11. sendNotification fires exactly once per gate-failure mount
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { generateKeyPairSync, sign, KeyObject } from 'crypto';

import { LicenseGate } from '../../components/license-gate.js';
import { renderWithProvider } from '../test-utils/index.js';
import { RENDER_AUD, RENDER_ISS, RENDER_KID } from '../../lib/license.js';

// ---------------------------------------------------------------------------
// Keypair + signing helper
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

afterEach(() => {
  vi.restoreAllMocks();
});

function b64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64url');
}

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
// Constants
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000;
const EXP = NOW + 86_400;
const CHILD_TESTID = 'main-component';

function TestChild() {
  return <div data-testid={CHILD_TESTID}>main-component-content</div>;
}

function baseClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: RENDER_ISS,
    aud: RENDER_AUD,
    sub: 'usr_test',
    iat: NOW - 60,
    exp: EXP,
    plan: 'paid',
    trial_expires_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

async function renderGate(
  token: string | undefined,
  nowOverride = NOW,
  devBypass = false,
) {
  const { adapter, ...result } = renderWithProvider(
    <LicenseGate
      now={nowOverride}
      publicKeyPem={testPublicKeyPem}
      devBypass={devBypass}
    >
      <TestChild />
    </LicenseGate>,
  );

  act(() => {
    adapter.setResourceMeta(
      token !== undefined ? { license: { token, kid: RENDER_KID } } : {},
    );
  });

  // Wait for async verification to resolve.
  await waitFor(
    () => {
      expect(
        screen.queryByTestId('license-gate-verifying'),
      ).not.toBeInTheDocument();
    },
    { timeout: 3000 },
  );

  return { adapter, ...result };
}

// ---------------------------------------------------------------------------
// Core gate cases
// ---------------------------------------------------------------------------

describe('LicenseGate', () => {
  // Case 1: Paid
  it('renders children with no banner for a valid paid token', async () => {
    const token = makeToken(baseClaims({ plan: 'paid' }));
    await renderGate(token);

    expect(screen.getByTestId(CHILD_TESTID)).toBeInTheDocument();
    expect(screen.queryByTestId('trial-banner')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('trial-expired-screen'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('license-required-screen'),
    ).not.toBeInTheDocument();
  });

  // Case 2: Trial
  it('renders TrialBanner + children for a valid trial token', async () => {
    const trialExp = NOW + 5 * 86_400;
    const token = makeToken(
      baseClaims({ plan: 'trial', trial_expires_at: trialExp }),
    );
    await renderGate(token);

    expect(screen.getByTestId('trial-banner')).toBeInTheDocument();
    expect(screen.getByTestId(CHILD_TESTID)).toBeInTheDocument();
    expect(screen.getByTestId('trial-banner').textContent).toMatch(/\d+ day/);
  });

  // Case 3: Trial-expired (trial_expires_at past)
  it('renders TrialExpiredScreen only when trial has expired', async () => {
    const trialExp = NOW - 3600;
    const token = makeToken(
      baseClaims({ plan: 'trial', trial_expires_at: trialExp }),
    );
    await renderGate(token);

    expect(screen.getByTestId('trial-expired-screen')).toBeInTheDocument();
    expect(screen.queryByTestId(CHILD_TESTID)).not.toBeInTheDocument();
  });

  // Case 4: Missing token
  it('renders LicenseRequiredScreen when token is missing', async () => {
    await renderGate(undefined);

    expect(screen.getByTestId('license-required-screen')).toBeInTheDocument();
    expect(screen.queryByTestId(CHILD_TESTID)).not.toBeInTheDocument();
  });

  // Case 5: Tampered signature
  it('renders LicenseRequiredScreen for a tampered token', async () => {
    const token = makeToken(baseClaims());
    const parts = token.split('.');
    const tampered = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    await renderGate(`${parts[0]}.${parts[1]}.${tampered}`);

    expect(screen.getByTestId('license-required-screen')).toBeInTheDocument();
    expect(screen.queryByTestId(CHILD_TESTID)).not.toBeInTheDocument();
  });

  // Case 6: Wrong aud
  it('renders LicenseRequiredScreen for wrong audience', async () => {
    const token = makeToken(baseClaims({ aud: 'wrong-audience' }));
    await renderGate(token);

    expect(screen.getByTestId('license-required-screen')).toBeInTheDocument();
    expect(screen.queryByTestId(CHILD_TESTID)).not.toBeInTheDocument();
  });

  // Case 7: Wrong iss
  it('renders LicenseRequiredScreen for wrong issuer', async () => {
    const token = makeToken(baseClaims({ iss: 'https://evil.example.com' }));
    await renderGate(token);

    expect(screen.getByTestId('license-required-screen')).toBeInTheDocument();
    expect(screen.queryByTestId(CHILD_TESTID)).not.toBeInTheDocument();
  });

  // Case 8: Expired token (zero-grace)
  it('renders LicenseRequiredScreen when now > exp', async () => {
    const token = makeToken(baseClaims({ exp: NOW - 1 }));
    await renderGate(token, NOW);

    expect(screen.getByTestId('license-required-screen')).toBeInTheDocument();
    expect(screen.queryByTestId(CHILD_TESTID)).not.toBeInTheDocument();
  });

  // Case 9: Unknown kid
  it('renders LicenseRequiredScreen for an unknown kid', async () => {
    const token = makeToken(baseClaims(), 'agntux-render-unknown-v99');
    await renderGate(token);

    expect(screen.getByTestId('license-required-screen')).toBeInTheDocument();
    expect(screen.queryByTestId(CHILD_TESTID)).not.toBeInTheDocument();
  });

  // Case 10: Dev-mode bypass (missing token + devBypass=true)
  it('shows DevModeBanner and renders children when devBypass=true and token missing', async () => {
    await renderGate(undefined, NOW, true);

    expect(screen.getByTestId('dev-mode-banner')).toBeInTheDocument();
    expect(screen.getByTestId(CHILD_TESTID)).toBeInTheDocument();
    expect(
      screen.queryByTestId('license-required-screen'),
    ).not.toBeInTheDocument();
  });

  it('does NOT bypass for invalid signature even in dev mode', async () => {
    const token = makeToken(baseClaims());
    const parts = token.split('.');
    await renderGate(`${parts[0]}.${parts[1]}.INVALIDSIG`, NOW, true);

    expect(screen.getByTestId('license-required-screen')).toBeInTheDocument();
    expect(screen.queryByTestId(CHILD_TESTID)).not.toBeInTheDocument();
  });

  // Case 11: sendNotification fires exactly once per gate-failure mount
  it('sends ui/notifications/license-failed exactly once on a blocked mount', async () => {
    const { adapter } = await renderGate(undefined);

    const notifications = adapter
      .getSentNotifications()
      .filter((n) => n.method === 'ui/notifications/license-failed');

    expect(notifications).toHaveLength(1);
    expect(notifications[0].params?.reason).toBe('missing');
  });

  it('sends ui/notifications/license-failed exactly once for trial-expired', async () => {
    const trialExp = NOW - 1;
    const token = makeToken(
      baseClaims({ plan: 'trial', trial_expires_at: trialExp }),
    );
    const { adapter } = await renderGate(token);

    const notifications = adapter
      .getSentNotifications()
      .filter((n) => n.method === 'ui/notifications/license-failed');

    expect(notifications).toHaveLength(1);
    expect(notifications[0].params?.reason).toBe('trial-expired');
  });

  it('does NOT send license-failed notification for a paid token', async () => {
    const token = makeToken(baseClaims({ plan: 'paid' }));
    const { adapter } = await renderGate(token);

    const notifications = adapter
      .getSentNotifications()
      .filter((n) => n.method === 'ui/notifications/license-failed');

    expect(notifications).toHaveLength(0);
  });

  it('does NOT send license-failed for a trial token with days remaining', async () => {
    const token = makeToken(
      baseClaims({ plan: 'trial', trial_expires_at: NOW + 86_400 }),
    );
    const { adapter } = await renderGate(token);

    const notifications = adapter
      .getSentNotifications()
      .filter((n) => n.method === 'ui/notifications/license-failed');

    expect(notifications).toHaveLength(0);
  });

  it('includes kid and exp in license-failed notification for expired token', async () => {
    const token = makeToken(baseClaims({ exp: NOW - 1 }));
    const { adapter } = await renderGate(token, NOW);

    const notifications = adapter
      .getSentNotifications()
      .filter((n) => n.method === 'ui/notifications/license-failed');

    expect(notifications).toHaveLength(1);
    const params = notifications[0].params!;
    expect(params.reason).toBe('expired');
    expect(params.now).toBe(NOW);
    expect(typeof params.exp).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Screen copy assertions
// ---------------------------------------------------------------------------

describe('LicenseGate screen copy', () => {
  it('TrialExpiredScreen shows upgrade heading', async () => {
    const token = makeToken(
      baseClaims({ plan: 'trial', trial_expires_at: NOW - 1 }),
    );
    await renderGate(token);

    const el = screen.getByTestId('trial-expired-screen');
    expect(
      el.querySelector('[data-testid="gate-heading"]')?.textContent,
    ).toMatch(/trial has ended/i);
    expect(
      el.querySelector('[data-testid="gate-primary-action"]'),
    ).toBeTruthy();
  });

  it('LicenseRequiredScreen shows reason-aware copy for missing token', async () => {
    await renderGate(undefined);

    const el = screen.getByTestId('license-required-screen');
    expect(
      el.querySelector('[data-testid="gate-heading"]')?.textContent,
    ).toMatch(/license required/i);
    expect(el.querySelector('[data-testid="gate-body"]')?.textContent).toMatch(
      /no license token/i,
    );
  });

  it('TrialBanner shows correct day count', async () => {
    const token = makeToken(
      baseClaims({ plan: 'trial', trial_expires_at: NOW + 3 * 86_400 }),
    );
    await renderGate(token);

    expect(screen.getByTestId('trial-banner').textContent).toMatch(/3 day/);
  });
});

// ---------------------------------------------------------------------------
// Inline viewport budget
// ---------------------------------------------------------------------------

describe('LicenseGate inline viewport budget', () => {
  it('TrialExpiredScreen mounts inside a 600px viewport without overflowing', async () => {
    const token = makeToken(
      baseClaims({ plan: 'trial', trial_expires_at: NOW - 1 }),
    );

    const viewport = document.createElement('div');
    viewport.style.cssText =
      'height:600px;width:400px;overflow:hidden;position:relative';
    document.body.appendChild(viewport);

    try {
      const { adapter } = renderWithProvider(
        <LicenseGate
          now={NOW}
          publicKeyPem={testPublicKeyPem}
          devBypass={false}
        >
          <TestChild />
        </LicenseGate>,
      );

      act(() => {
        adapter.setResourceMeta({ license: { token, kid: RENDER_KID } });
      });

      await waitFor(
        () => {
          expect(
            screen.queryByTestId('license-gate-verifying'),
          ).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      expect(
        document.querySelector('[data-testid="trial-expired-screen"]'),
      ).toBeTruthy();
    } finally {
      document.body.removeChild(viewport);
    }
  });
});
