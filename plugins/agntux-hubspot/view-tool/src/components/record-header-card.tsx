import { useAppsClient } from '../lib/apps-react/index.js';

interface RecordHeaderCardProps {
  recordName: string;
  recordType?: string;
  recordUrl?: string;
  badge?: string;
  meta?: string;
}

export function RecordHeaderCard({ recordName, recordType, recordUrl, badge, meta }: RecordHeaderCardProps) {
  const client = useAppsClient();

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 mb-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {(recordType || badge) && (
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {recordType && (
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">
                  {recordType}
                </span>
              )}
              {badge && (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {badge}
                </span>
              )}
            </div>
          )}
          <p className="text-sm font-semibold text-foreground leading-snug break-words">
            {recordName || 'HubSpot record'}
          </p>
          {meta && (
            <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
          )}
        </div>
        {recordUrl && (
          <button
            type="button"
            className="shrink-0 ml-2 text-xs text-primary underline underline-offset-2 hover:text-primary/80 flex items-center gap-1"
            onClick={() => { void client.openLink(recordUrl); }}
            aria-label={`Open ${recordName || 'record'} in HubSpot`}
          >
            Open in HubSpot
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="w-3 h-3"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.22 11.78a.75.75 0 0 1 0-1.06L9.44 5.5H5.75a.75.75 0 0 1 0-1.5h5.5a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0V6.56l-5.22 5.22a.75.75 0 0 1-1.06 0Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
