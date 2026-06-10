import { useAppsClient } from '../lib/apps-react/index.js';

interface IssueHeaderCardProps {
  issueKey: string;
  issueTitle: string;
  issueUrl?: string;
  badge?: string;
  badgeColor?: string;
}

// Status badge color map (narrow whitelist of semantic Tailwind tokens).
// Only these status names get a colored badge; all others fall back to muted.
const STATUS_COLORS: Record<string, string> = {
  'Done': 'bg-green-100 text-green-800',
  'In Progress': 'bg-blue-100 text-blue-800',
  'In Review': 'bg-purple-100 text-purple-800',
  'To Do': 'bg-slate-100 text-slate-700',
  'Blocked': 'bg-red-100 text-red-800',
  'Closed': 'bg-green-100 text-green-800',
};

function statusClass(status: string): string {
  return STATUS_COLORS[status] ?? 'bg-muted text-muted-foreground';
}

export function IssueHeaderCard({ issueKey, issueTitle, issueUrl, badge }: IssueHeaderCardProps) {
  const client = useAppsClient();

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 mb-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-mono font-semibold text-muted-foreground shrink-0">
              {issueKey || 'ISSUE'}
            </span>
            {badge && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(badge)}`}>
                {badge}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-foreground leading-snug break-words">
            {issueTitle || 'Jira issue'}
          </p>
        </div>
        {issueUrl && (
          <button
            type="button"
            className="shrink-0 ml-2 text-xs text-primary underline underline-offset-2 hover:text-primary/80 flex items-center gap-1"
            onClick={() => { void client.openLink(issueUrl); }}
            aria-label={`Open ${issueKey} in Jira`}
          >
            Open
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
