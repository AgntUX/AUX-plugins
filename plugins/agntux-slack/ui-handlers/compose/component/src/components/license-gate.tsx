/**
 * LicenseGate — render-token gate for the AgntUX license system (P2a).
 *
 * Wraps <MainComponent> inside <App>. Reads the host-signed render token
 * from `_meta.license`, verifies it inside the iframe with the bundled
 * Ed25519 public key, and decides between four outcomes:
 *
 *   - paid          → render children unchanged
 *   - trial         → sticky TrialBanner above children (non-dismissible)
 *   - trial-expired → TrialExpiredScreen
 *   - blocked       → LicenseRequiredScreen with reason-aware copy
 *
 * Dev-mode (`import.meta.env.DEV`) shows a yellow DEV banner instead of
 * blocking when the token is missing. Production builds NEVER bypass.
 *
 * On any blocked / trial-expired / dev-bypass mount, fires
 * `ui/notifications/license-failed` exactly once with `{ reason, kid?, now,
 * exp? }` for host-side observability.
 *
 * Design language: editorial enterprise — cream paper background,
 * Iowan/Garamond serif headlines, mono tabular-nums for metadata, deep
 * oxblood + sage accents. Refuses purple gradients. See P2a §4.5 for the
 * UX spec the visual surface satisfies.
 */

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useAppsClient, useResourceMeta } from '../lib/apps-react/index.js';
import { useTranslation } from '../hooks/use-translation.js';
import {
  evaluateGate,
  trialDaysRemaining,
  verifyRenderToken,
  type GateOutcome,
  type RenderTokenClaims,
  type VerifyFailureReason,
} from '../lib/license.js';

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface LicenseGateProps {
  children: ReactNode;
  /**
   * Override clock for tests — defaults to `Math.floor(Date.now()/1000)`.
   * Production code never sets this.
   */
  now?: number;
  /** Override public key (test-only). Production code never sets this. */
  publicKeyPem?: string;
  /** Force dev-mode bypass on/off (test-only). */
  devBypass?: boolean;
}

interface VerificationState {
  status: 'verifying' | 'ok' | 'failed';
  payload?: RenderTokenClaims;
  reason?: VerifyFailureReason;
  kid?: string;
  /** Decoded exp from the token (even on failure) for notification payload. */
  rawExp?: number;
}

export function LicenseGate({
  children,
  now: nowOverride,
  publicKeyPem,
  devBypass: devBypassOverride,
}: LicenseGateProps) {
  const meta = useResourceMeta();
  const client = useAppsClient();

  const isDevBypass = useMemo(() => {
    if (typeof devBypassOverride === 'boolean') return devBypassOverride;
    // import.meta.env.DEV is true under `vite dev`. Production bundles
    // statically resolve this to `false`, so the bypass is physically
    // impossible in production.
    return Boolean(
      typeof import.meta !== 'undefined' &&
      (import.meta as { env?: { DEV?: boolean } }).env?.DEV,
    );
  }, [devBypassOverride]);

  const [state, setState] = useState<VerificationState>(() => ({
    status: 'verifying',
  }));

  const token = readToken(meta);
  // `meta === undefined` means the host hasn't surfaced the resource envelope
  // yet — stay in `verifying` state rather than immediately failing with
  // `missing`. Only transition to `failed/missing` once meta has arrived
  // (even as `{}`) but contains no token.
  const metaReceived = meta !== undefined;

  // Verify token whenever the token string / meta-received status changes.
  // We deliberately memoize verification on the token *string* — the claims
  // are pure and identical across re-renders for the same token.
  useEffect(() => {
    let cancelled = false;
    if (!metaReceived) {
      // Still waiting for the host to surface the resource envelope.
      setState({ status: 'verifying' });
      return;
    }
    if (!token) {
      setState({ status: 'failed', reason: 'missing' });
      return;
    }

    void (async () => {
      const result = await verifyRenderToken(token, {
        now: nowOverride,
        publicKeyPem,
      });
      if (cancelled) return;
      if (result.ok) {
        setState({
          status: 'ok',
          payload: result.payload,
          kid: result.payload.kid,
        });
      } else {
        // For observability, try to extract exp from the token even on failure
        // so the license-failed notification can include it.
        const rawExp = tryDecodeExp(token);
        setState({ status: 'failed', reason: result.reason, rawExp });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, metaReceived, nowOverride, publicKeyPem]);

  // Compute the gate outcome (paid / trial / trial-expired / blocked).
  const now = useMemo(
    () =>
      typeof nowOverride === 'number'
        ? nowOverride
        : Math.floor(Date.now() / 1000),
    [nowOverride, state.status],
  );

  const outcome = useMemo<GateOutcome>(() => {
    if (state.status === 'verifying') return 'paid'; // placeholder; render path below short-circuits
    if (state.status === 'failed') return 'blocked';
    return evaluateGate(state.payload ?? null, now);
  }, [state.status, state.payload, now]);

  // Notify host once per blocked/trial-expired mount. Identity-keyed by
  // (status, reason, outcome) so a state transition during retry triggers
  // exactly one notification per terminal failure.
  const notifiedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.status === 'verifying') return;

    let reason: string | null = null;
    if (state.status === 'failed' && state.reason) {
      reason = state.reason;
    } else if (outcome === 'trial-expired') {
      // plan: 'expired' vs trial date past — distinguish in the payload.
      reason =
        state.payload?.plan === 'expired' ? 'plan-expired' : 'trial-expired';
    }
    if (!reason) return;

    const key = `${state.status}:${reason}`;
    if (notifiedKeyRef.current === key) return;
    notifiedKeyRef.current = key;

    const params: Record<string, unknown> = {
      reason,
      now,
    };
    if (state.kid ?? state.payload?.kid) {
      params.kid = state.kid ?? state.payload?.kid;
    }
    const exp = state.payload?.exp ?? state.rawExp;
    if (typeof exp === 'number') {
      params.exp = exp;
    }
    void client.sendNotification('ui/notifications/license-failed', params);
  }, [state, outcome, now, client]);

  // Dev-mode bypass: missing token + DEV build → render with a dev banner
  // instead of blocking. Any other failure (invalid signature, wrong aud,
  // expired) still blocks even in dev — those are real bugs, not config.
  if (isDevBypass && state.status === 'failed' && state.reason === 'missing') {
    return (
      <>
        <DevModeBanner />
        <div className="pt-8">{children}</div>
      </>
    );
  }

  // While verifying, render nothing — the verify path is async but
  // resolves in <50ms with the bundled key. A flash-of-block would be
  // worse than a single empty frame.
  if (state.status === 'verifying') {
    return <GateLoadingShell />;
  }

  if (outcome === 'paid') {
    return <>{children}</>;
  }

  if (outcome === 'trial' && state.payload) {
    const days = trialDaysRemaining(state.payload, now);
    return (
      <>
        <TrialBanner days={days} client={client} />
        <div className="pt-8">{children}</div>
      </>
    );
  }

  if (outcome === 'trial-expired' && state.payload) {
    return (
      <TrialExpiredScreen
        client={client}
        kid={state.payload.kid}
        exp={state.payload.exp}
      />
    );
  }

  // Blocked.
  return (
    <LicenseRequiredScreen
      client={client}
      reason={state.reason ?? 'tampered-claim'}
      kid={state.kid}
      exp={state.payload?.exp}
      now={now}
    />
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface MinimalClient {
  openLink(url: string): Promise<void>;
}

interface TrialBannerProps {
  days: number;
  client: MinimalClient;
}

export function TrialBanner({ days, client }: TrialBannerProps) {
  const { t } = useTranslation();
  const isUrgent = days < 2;
  const bannerLabel =
    days === 0
      ? t('license.trial.banner.today')
      : isUrgent
        ? t('license.trial.banner.urgent', { days, s: days === 1 ? '' : 's' })
        : t('license.trial.banner.normal', { days, s: days === 1 ? '' : 's' });

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="trial-banner"
      className={[
        'fixed top-0 left-0 right-0 z-50',
        'flex items-center gap-3 px-4 h-8',
        'border-b text-[11px] tracking-[0.02em] tabular-nums',
        isUrgent
          ? 'bg-red-50 text-red-900 border-red-200'
          : 'bg-amber-50 text-amber-900 border-amber-200',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'inline-block h-1.5 w-1.5 shrink-0',
          isUrgent ? 'bg-red-700' : 'bg-amber-700',
        ].join(' ')}
      />
      <span className="font-mono uppercase tracking-[0.14em] text-[10px] opacity-70">
        {t('license.eyebrow.trial')}
      </span>
      <span className="font-medium">{bannerLabel}</span>
      <span className="ml-auto">
        <button
          type="button"
          onClick={() => {
            void client.openLink('https://agntux.ai/upgrade');
          }}
          className={[
            'inline-flex items-center gap-1 px-2.5 py-1',
            'text-[11px] font-semibold uppercase tracking-[0.08em]',
            'border-b border-current',
            'hover:opacity-80 transition-opacity',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1',
          ].join(' ')}
        >
          {t('license.action.upgrade')}
          <span aria-hidden="true">→</span>
        </button>
      </span>
    </div>
  );
}

interface TrialExpiredScreenProps {
  client: MinimalClient;
  kid?: string;
  exp: number;
}

export function TrialExpiredScreen({
  client,
  kid,
  exp,
}: TrialExpiredScreenProps) {
  const { t } = useTranslation();
  return (
    <GateScreen
      eyebrow={t('license.eyebrow.expired')}
      heading={t('license.expired.heading')}
      body={t('license.expired.body')}
      primaryAction={{
        label: t('license.action.upgrade'),
        onClick: () => {
          void client.openLink('https://agntux.ai/upgrade');
        },
      }}
      secondaryAction={{
        label: t('license.action.refresh'),
        hint: t('license.action.refresh.hint'),
      }}
      metadata={[
        { label: 'STATUS', value: 'EXPIRED' },
        { label: 'KID', value: kid ?? '—' },
        { label: 'EXP', value: formatTimestamp(exp) },
      ]}
      testId="trial-expired-screen"
    />
  );
}

interface LicenseRequiredScreenProps {
  client: MinimalClient;
  reason: VerifyFailureReason;
  kid?: string;
  exp?: number;
  now: number;
}

export function LicenseRequiredScreen({
  client,
  reason,
  kid,
  exp,
  now,
}: LicenseRequiredScreenProps) {
  const { t } = useTranslation();
  const reasonCopy = t(`license.blocked.reason.${reason}`);
  return (
    <GateScreen
      eyebrow={t('license.eyebrow.required')}
      heading={t('license.required.heading')}
      body={t('license.required.body', { reason: reasonCopy })}
      primaryAction={{
        label: t('license.action.signin'),
        onClick: () => {
          void client.openLink('https://agntux.ai/signin');
        },
      }}
      metadata={[
        { label: 'STATUS', value: reason.toUpperCase().replace(/-/g, ' ') },
        { label: 'KID', value: kid ?? '—' },
        {
          label: 'EXP',
          value: typeof exp === 'number' ? formatTimestamp(exp) : '—',
        },
        { label: 'NOW', value: formatTimestamp(now) },
      ]}
      testId="license-required-screen"
    />
  );
}

function DevModeBanner() {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="dev-mode-banner"
      className={[
        'fixed top-0 left-0 right-0 z-50',
        'flex items-center gap-3 px-4 h-8',
        'border-b border-yellow-300 bg-yellow-100 text-yellow-900',
        'text-[11px] tracking-[0.02em]',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 shrink-0 bg-yellow-700"
      />
      <span className="font-mono uppercase tracking-[0.14em] text-[10px] opacity-70">
        {t('license.eyebrow.dev')}
      </span>
      <span className="font-medium">{t('license.dev.banner')}</span>
    </div>
  );
}

function GateLoadingShell() {
  // Render an empty paper-toned frame that won't flash content. The verify
  // step typically completes within one paint frame.
  return (
    <div
      data-testid="license-gate-verifying"
      aria-hidden="true"
      className="h-full bg-[#FAF7F2]"
    />
  );
}

interface MetadataEntry {
  label: string;
  value: string;
}

interface GateScreenProps {
  eyebrow: string;
  heading: string;
  body: string;
  primaryAction: { label: string; onClick: () => void };
  secondaryAction?: { label: string; hint: string };
  metadata: MetadataEntry[];
  testId: string;
}

function GateScreen({
  eyebrow,
  heading,
  body,
  primaryAction,
  secondaryAction,
  metadata,
  testId,
}: GateScreenProps) {
  return (
    <div
      data-testid={testId}
      className={[
        'h-full overflow-y-auto',
        // Cream paper background — refuses generic AI-purple gradient.
        'bg-[#FAF7F2] text-[#0A0A0A]',
        // Subtle paper-grain via two-axis radial gradients (zero JS, tiny CSS).
        '[background-image:radial-gradient(rgba(10,10,10,0.025)_1px,transparent_1px)]',
        '[background-size:6px_6px]',
      ].join(' ')}
    >
      <div className="mx-auto flex min-h-full max-w-md flex-col px-6 py-10">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 bg-[#8B2D2D]"
          />
          <span
            data-testid="gate-eyebrow"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8B2D2D]"
          >
            {eyebrow}
          </span>
        </div>

        <h1
          data-testid="gate-heading"
          className={[
            'mt-6 text-[28px] leading-[1.15] tracking-[-0.01em]',
            // Editorial serif stack — no Inter, no system-ui, no purple.
            "font-normal [font-family:ui-serif,'Iowan_Old_Style','Apple_Garamond',Georgia,serif]",
          ].join(' ')}
        >
          {heading}
        </h1>

        <p
          data-testid="gate-body"
          className="mt-4 text-[14px] leading-[1.55] text-[#3A3A3A]"
        >
          {body}
        </p>

        <div className="mt-8 flex flex-col items-start gap-3">
          <button
            type="button"
            onClick={primaryAction.onClick}
            data-testid="gate-primary-action"
            className={[
              'inline-flex items-center gap-2 px-4 py-2',
              'bg-[#0A0A0A] text-[#FAF7F2]',
              'text-[12px] font-medium uppercase tracking-[0.12em]',
              'hover:bg-[#1F1F1F] transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF7F2]',
            ].join(' ')}
          >
            {primaryAction.label}
            <span aria-hidden="true">→</span>
          </button>
          {secondaryAction && (
            <p className="text-[12px] text-[#6B6B6B]">
              <span className="font-medium text-[#3A3A3A]">
                {secondaryAction.label}
              </span>{' '}
              <span>{secondaryAction.hint}</span>
            </p>
          )}
        </div>

        <div className="mt-auto pt-10">
          <div className="border-t border-[#E5E0D6] pt-4">
            <dl
              data-testid="gate-metadata"
              className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 font-mono text-[10px] tabular-nums"
            >
              {metadata.map((entry) => (
                <div key={entry.label} className="contents">
                  <dt className="uppercase tracking-[0.14em] text-[#8B8B8B]">
                    {entry.label}
                  </dt>
                  <dd className="text-[#3A3A3A]">{entry.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readToken(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const license = (meta as { license?: unknown }).license;
  if (!license || typeof license !== 'object') return undefined;
  const token = (license as { token?: unknown }).token;
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/**
 * Unsafely decode the JWT payload section (no signature check) to extract
 * the `exp` claim. Used only to enrich license-failed notifications — never
 * for gate decisions.
 */
function tryDecodeExp(token: string): number | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const pad = '='.repeat((4 - (parts[1].length % 4)) % 4);
    const json = atob
      ? atob((parts[1] + pad).replace(/-/g, '+').replace(/_/g, '/'))
      : Buffer.from(parts[1] + pad, 'base64').toString('binary');
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return typeof parsed.exp === 'number' ? parsed.exp : undefined;
  } catch {
    return undefined;
  }
}

function formatTimestamp(epochSeconds: number): string {
  // Always UTC, ISO-ish — feels like a stamped document, no timezone math
  // mistakes. yyyy-mm-dd HH:MM:SSZ.
  const d = new Date(epochSeconds * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const MM = String(d.getUTCMinutes()).padStart(2, '0');
  const SS = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}Z`;
}
