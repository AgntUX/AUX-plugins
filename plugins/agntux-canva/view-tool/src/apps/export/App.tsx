import React, { useState, Suspense } from "react";
import { assertStructuredContent, ComponentErrorBoundary, ScrollablePanel, safeString, safeNumber, safeArray, Spinner } from "@agntux/ui-primitives";
import {
  useToolResult,
  useAppsClient,
  useHostStyleVariables,
  useDocumentTheme,
} from "../../lib/apps-react/index.js";
import { buildExportEnvelope } from "./lib/build-envelope.js";
import { ExternalLink } from "../external-link.js";

// All format types the Canva export connector supports.
const ALL_FORMAT_LABELS: Record<string, string> = {
  pdf: "PDF",
  png: "PNG",
  jpg: "JPG",
  pptx: "PowerPoint",
  gif: "GIF",
  mp4: "MP4 video",
  csv: "CSV",
};

interface ExportPayload {
  design_url: string;
  design_id: string;
  design_title: string;
  available_formats: string[];
  default_format: string;
  page_count: number;
}

function parsePageRange(raw: string, pageCount: number): number[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Support "1,2,3" or "1-3" or "1, 3-5"
  const pages: number[] = [];
  const segments = trimmed.split(",");
  for (const seg of segments) {
    const rangeParts = seg.trim().split("-");
    if (rangeParts.length === 2) {
      const start = parseInt(rangeParts[0].trim(), 10);
      const end = parseInt(rangeParts[1].trim(), 10);
      if (isNaN(start) || isNaN(end)) return undefined;
      for (let p = start; p <= end; p++) {
        if (p >= 1 && p <= pageCount) pages.push(p);
      }
    } else {
      const p = parseInt(seg.trim(), 10);
      if (isNaN(p)) return undefined;
      if (p >= 1 && p <= pageCount) pages.push(p);
    }
  }
  // Remove duplicates and sort
  const unique = [...new Set(pages)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : undefined;
}

function ExportForm() {
  useHostStyleVariables();
  useDocumentTheme();

  const client = useAppsClient();
  const toolOutput = useToolResult();
  const raw = assertStructuredContent<ExportPayload>(
    toolOutput as Record<string, unknown> | undefined,
  );

  const designId = safeString(raw?.design_id);
  const designUrl = safeString(raw?.design_url);
  const designTitle = safeString(raw?.design_title, "Canva design");
  const pageCount = safeNumber(raw?.page_count, 1);

  // Parse available_formats from the payload (only strings that are valid keys)
  const rawFormats = safeArray(raw?.available_formats);
  const availableFormats: string[] = rawFormats
    .filter((f): f is string => typeof f === "string" && f.length > 0);

  const defaultFmt = safeString(raw?.default_format);
  const initialFormat =
    defaultFmt && availableFormats.includes(defaultFmt)
      ? defaultFmt
      : availableFormats.length > 0
      ? availableFormats[0]
      : "pdf";

  const [selectedFormat, setSelectedFormat] = useState(initialFormat);
  const [allPages, setAllPages] = useState(true);
  const [pageRangeText, setPageRangeText] = useState("");
  const [pageRangeError, setPageRangeError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function handlePageRangeChange(value: string) {
    setPageRangeText(value);
    setPageRangeError("");
  }

  async function handleExport() {
    setSending(true);
    setError("");
    setPageRangeError("");

    let pages: number[] | undefined;
    if (!allPages) {
      if (pageRangeText.trim()) {
        const parsed = parsePageRange(pageRangeText, pageCount);
        if (!parsed) {
          setPageRangeError(
            'Enter page numbers or ranges like "1-3" or "1, 4".',
          );
          setSending(false);
          return;
        }
        pages = parsed;
      }
      // If range text is empty and allPages is false, export all pages
    }

    try {
      const envelope = buildExportEnvelope({
        design_id: designId,
        format_type: selectedFormat,
        pages,
      });
      await client.sendFollowUpMessage(envelope);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start export.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <ScrollablePanel title="Export started">
        <div className="p-4 text-sm text-green-700">
          Export is in progress. You will receive a download link shortly.
        </div>
      </ScrollablePanel>
    );
  }

  const headerTitle = (
    <span className="text-sm font-semibold text-gray-900 truncate">
      {designTitle || "Export design"}
    </span>
  );

  const footer = (
    <div className="p-3 border-t border-gray-200 flex flex-col gap-2">
      {error && (
        <span className="text-xs text-red-600">{error}</span>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-400">
          You will get a download link back.
        </p>
        <button
          type="button"
          disabled={sending || availableFormats.length === 0}
          onClick={() => void handleExport()}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? <Spinner size={4} /> : null}
          Export
        </button>
      </div>
    </div>
  );

  return (
    <ScrollablePanel
      title={headerTitle}
      onHelpClick={designUrl ? () => void client.openLink(designUrl) : undefined}
      helpLabel="Open in Canva ↗"
      footer={footer}
    >
      <div className="p-3 space-y-4">
        {/* Design context + open link */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500 truncate">
            Canva design
            {designUrl && (
              <>
                {" · "}
                <ExternalLink
                  href={designUrl}
                  className="text-indigo-600 hover:underline"
                  ariaLabel="Open design in Canva"
                >
                  Open ↗
                </ExternalLink>
              </>
            )}
          </span>
        </div>

        {/* Format picker */}
        <div>
          <p className="block text-xs font-medium text-gray-700 mb-2">
            Format
          </p>
          {availableFormats.length === 0 ? (
            <p className="text-xs text-gray-500">No formats available for this design.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableFormats.map((fmt) => (
                <label
                  key={fmt}
                  className={
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm cursor-pointer select-none " +
                    (selectedFormat === fmt
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium"
                      : "border-gray-300 bg-white text-gray-700 hover:border-indigo-400")
                  }
                >
                  <input
                    type="radio"
                    name="canva-export-format"
                    value={fmt}
                    checked={selectedFormat === fmt}
                    onChange={() => setSelectedFormat(fmt)}
                    className="sr-only"
                  />
                  {ALL_FORMAT_LABELS[fmt] ?? fmt.toUpperCase()}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Pages control — only shown when pageCount > 1 */}
        {pageCount > 1 && (
          <div>
            <p className="block text-xs font-medium text-gray-700 mb-2">
              Pages
            </p>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allPages}
                onChange={(e) => {
                  setAllPages(e.target.checked);
                  if (e.target.checked) {
                    setPageRangeText("");
                    setPageRangeError("");
                  }
                }}
                className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              All {pageCount} pages
            </label>

            {!allPages && (
              <div className="mt-2">
                <input
                  type="text"
                  id="canva-export-pages"
                  value={pageRangeText}
                  onChange={(e) => handlePageRangeChange(e.target.value)}
                  placeholder={'e.g. "1-3" or "1, 4, 6"'}
                  className={
                    "w-full rounded-md border px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 " +
                    (pageRangeError ? "border-red-400" : "border-gray-300")
                  }
                />
                {pageRangeError && (
                  <p className="mt-1 text-xs text-red-600">{pageRangeError}</p>
                )}
                <p className="mt-1 text-xs text-gray-400">
                  Leave blank to export all pages.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </ScrollablePanel>
  );
}

export function ExportApp() {
  return (
    <ComponentErrorBoundary>
      <Suspense fallback={<Spinner />}>
        <ExportForm />
      </Suspense>
    </ComponentErrorBoundary>
  );
}
