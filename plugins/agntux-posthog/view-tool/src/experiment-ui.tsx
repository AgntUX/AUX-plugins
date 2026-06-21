// experiment-ui.tsx — PostHog Ship Experiment Variant iframe entry.
//
// Mounted by experiment.html. Reads ExperimentPayload from structuredContent,
// renders the quoted experiment context, a variant picker, and a
// "Ship variant" button wired to the experiment build-envelope.

import { StrictMode, useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AppsProvider,
  useAppsClient,
  useToolResult,
  useToolInput,
  useOnToolInputPartial,
  useDocumentTheme,
  useHostStyleVariables,
} from './lib/apps-react/index.js';
import { ComponentErrorBoundary, ScrollablePanel } from "@agntux/ui-primitives";
import { buildEnvelope } from './apps/experiment/lib/build-envelope.js';
import { ExternalLink } from './components/external-link.js';
import './globals.css';

// ── Payload shape ─────────────────────────────────────────────────────────────

interface ExperimentPayload {
  action_id: string;
  experiment_url: string;
  experiment_id: string;
  experiment_name: string;
  variants: string[];
  recommended_variant: string;
  result_summary: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function parsePayload(toolOutput?: Record<string, unknown>): ExperimentPayload {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    action_id: str(payload.action_id),
    experiment_url: str(payload.experiment_url),
    experiment_id: str(payload.experiment_id),
    experiment_name: str(payload.experiment_name),
    variants: strArr(payload.variants),
    recommended_variant: str(payload.recommended_variant),
    result_summary: str(payload.result_summary),
  };
}

// ── Main component ────────────────────────────────────────────────────────────

function ExperimentApp() {
  useDocumentTheme('light', 'dark');
  useHostStyleVariables();

  const client = useAppsClient();
  const toolResult = useToolResult();
  const toolInput = useToolInput();
  void toolInput;

  const [partialInput, setPartialInput] = useState<Record<string, unknown> | undefined>(undefined);
  useOnToolInputPartial((input) => setPartialInput(input));

  const toolOutput =
    toolResult && Object.keys(toolResult).length > 0
      ? (Object.values(toolResult)[0] as Record<string, unknown> | undefined)
      : undefined;

  const effectiveToolOutput =
    toolOutput ??
    (partialInput && Object.keys(partialInput).length > 0
      ? ({ _meta: { payload: partialInput } } as Record<string, unknown>)
      : undefined);

  const isStreaming = !toolOutput && !!partialInput;

  const data = useMemo(() => parsePayload(effectiveToolOutput), [effectiveToolOutput]);

  const [variantKey, setVariantKey] = useState<string>('');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Initialise picker from recommended_variant on first real data arrival
  const [initialised, setInitialised] = useState(false);
  if (!initialised && data.action_id) {
    setVariantKey(data.recommended_variant || (data.variants[0] ?? ''));
    setInitialised(true);
  }

  const isLoading = !effectiveToolOutput;

  async function handleSend() {
    if (!data.action_id || !data.experiment_id || !variantKey) return;
    setSendState('sending');
    setErrorMsg('');
    try {
      const envelope = buildEnvelope({
        experiment_id: data.experiment_id,
        variant_key: variantKey,
        action_id: data.action_id,
      });
      await client.sendFollowUpMessage(envelope);
      setSendState('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'An error occurred.');
      setSendState('error');
    }
  }

  const openInPostHogLink = data.experiment_url ? (
    <ExternalLink
      href={data.experiment_url}
      className="text-xs text-primary underline-offset-2 hover:underline"
    >
      Open in PostHog
    </ExternalLink>
  ) : null;

  const footer = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      {sendState === 'done' ? (
        <p className="text-sm text-green-600 font-medium">Variant shipped.</p>
      ) : sendState === 'error' ? (
        <p className="text-sm text-destructive">{errorMsg || 'Failed to ship variant.'}</p>
      ) : (
        <span />
      )}
      <button
        type="button"
        disabled={
          isStreaming ||
          isLoading ||
          sendState === 'sending' ||
          sendState === 'done' ||
          !data.action_id ||
          !variantKey
        }
        onClick={() => void handleSend()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sendState === 'sending' ? 'Shipping…' : 'Ship variant'}
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6" data-testid="loading-skeleton">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 h-5 w-44 animate-pulse rounded bg-muted" />
          <div className="mb-3 h-4 w-full animate-pulse rounded bg-muted" />
          <div className="mb-3 h-4 w-4/5 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-8 w-28 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  // Effective variant options: use variants array if available, otherwise show the recommended
  const variantOptions =
    data.variants.length > 0
      ? data.variants
      : data.recommended_variant
      ? [data.recommended_variant]
      : [];

  return (
    <ScrollablePanel
      title={
        <div className="flex items-center justify-between w-full">
          <span className="font-semibold text-foreground">Ship Experiment Variant</span>
          {openInPostHogLink}
        </div>
      }
      footer={footer}
    >
      <fieldset disabled={isStreaming} className="contents">
        <div className="p-4 space-y-4">
          {/* Quoted experiment context */}
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Experiment
            </p>
            <p className="text-sm font-semibold text-foreground leading-snug">
              {data.experiment_name || '(no name)'}
            </p>
            {data.result_summary && (
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {data.result_summary}
              </p>
            )}
          </div>

          {/* Recommended badge */}
          {data.recommended_variant && (
            <p className="text-xs text-muted-foreground">
              Recommended:{' '}
              <span className="font-medium text-foreground">{data.recommended_variant}</span>
            </p>
          )}

          {/* Variant picker */}
          {variantOptions.length > 0 && (
            <div>
              <label htmlFor="experiment-variant" className="block text-sm font-medium text-foreground mb-1">
                Variant to ship
              </label>
              <select
                id="experiment-variant"
                value={variantKey}
                onChange={(e) => setVariantKey(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {variantOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                    {v === data.recommended_variant ? ' (recommended)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </fieldset>
    </ScrollablePanel>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const VIEW_MIN_HEIGHT_PX = 480;
if (typeof document !== 'undefined') {
  document.documentElement.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  if (document.body) {
    document.body.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  rootElement.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  createRoot(rootElement).render(
    <StrictMode>
      <AppsProvider>
        <ComponentErrorBoundary>
          <ExperimentApp />
        </ComponentErrorBoundary>
      </AppsProvider>
    </StrictMode>,
  );
}
