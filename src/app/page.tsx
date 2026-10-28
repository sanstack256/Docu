"use client";

import React, { useState, useEffect } from "react";

interface DiscoveredPage {
  url: string;
  title: string;
  path: string;
  section?: string;
  depth: number;
}

interface FailedPage {
  url: string;
  error: string;
}

interface ConversionResult {
  jobId: string;
  state: string;
  downloadToken: string;
  downloadUrl: string;
  fileName: string;
  fileSizeBytes?: number;
  pdfPageCount?: number;
  pagesTotal: number;
  pagesExtracted: number;
  failedPages: FailedPage[];
  warnings: string[];
}

type Step = "input" | "discovering" | "selection" | "processing" | "result";

export default function DocuApp() {
  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Discovery & Selection state
  const [jobId, setJobId] = useState<string | null>(null);
  const [siteTitle, setSiteTitle] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [discoveredPages, setDiscoveredPages] = useState<DiscoveredPage[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [discoveryWarnings, setDiscoveryWarnings] = useState<string[]>([]);
  const [searchFilter, setSearchFilter] = useState("");

  // Real-time Backend Processing state
  const [backendState, setBackendState] = useState<string>("queued");
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [processedCount, setProcessedCount] = useState<number>(0);
  const [totalToProcess, setTotalToProcess] = useState<number>(0);
  const [liveFailedCount, setLiveFailedCount] = useState<number>(0);

  // Result state
  const [result, setResult] = useState<ConversionResult | null>(null);

  // Poll actual backend job state during conversion
  useEffect(() => {
    if (step !== "processing" || !jobId) return;

    let active = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok || !active) return;
        const jobData = await res.json();
        if (!active) return;

        setBackendState(jobData.state || "processing");
        if (typeof jobData.processedPages === "number") {
          setProcessedCount(jobData.processedPages);
        }
        if (typeof jobData.totalSelected === "number" && jobData.totalSelected > 0) {
          setTotalToProcess(jobData.totalSelected);
        }
        if (Array.isArray(jobData.failedPages)) {
          setLiveFailedCount(jobData.failedPages.length);
        }

        if (jobData.state === "generating_pdf") {
          setProcessingStatus("Rendering vector PDF, table of contents, and page numbers...");
        } else if (jobData.state === "processing") {
          setProcessingStatus("Fetching and extracting documentation pages...");
        }
      } catch {
        // Ignore transient polling errors while main convert request is in flight
      }
    }, 500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [step, jobId]);

  const handleStartDiscovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a documentation website URL.");
      return;
    }

    try {
      setStep("discovering");
      setBackendState("discovering");
      setProcessingStatus("Validating URL and inspecting documentation structure...");

      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to discover documentation pages.");
      }

      const pages: DiscoveredPage[] = data.pages || [];
      if (pages.length === 0) {
        throw new Error("No accessible documentation pages were found within scope for this URL.");
      }

      const resolvedTitle = data.siteTitle || new URL(trimmed).hostname;
      setJobId(data.jobId);
      setSiteTitle(resolvedTitle);
      setDocumentTitle(resolvedTitle);
      setDiscoveredPages(pages);
      setDiscoveryWarnings(data.warnings || []);
      setSearchFilter("");

      // By default, select discovered pages up to the 20-page free limit
      const initialSelected = new Set<string>();
      pages.slice(0, 20).forEach((p: DiscoveredPage) => initialSelected.add(p.url));
      setSelectedUrls(initialSelected);

      setStep("selection");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred during discovery.");
      setStep("input");
    }
  };

  const togglePageSelection = (pageUrl: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(pageUrl)) {
        next.delete(pageUrl);
      } else {
        if (next.size >= 20) {
          setError("Free plan limit: A maximum of 20 pages can be selected per export.");
          return prev;
        }
        next.add(pageUrl);
      }
      setError(null);
      return next;
    });
  };

  const handleSelectAll = () => {
    setError(null);
    const next = new Set<string>();
    const filtered = getFilteredPages();
    for (const p of filtered) {
      if (next.size >= 20) break;
      next.add(p.url);
    }
    setSelectedUrls(next);
  };

  const handleDeselectAll = () => {
    setError(null);
    setSelectedUrls(new Set());
  };

  const runConversion = async (urlsToConvert: string[]) => {
    if (!jobId || urlsToConvert.length === 0) return;
    setError(null);

    try {
      setStep("processing");
      setBackendState("processing");
      setTotalToProcess(urlsToConvert.length);
      setProcessedCount(0);
      setLiveFailedCount(0);
      setProcessingStatus(`Extracting ${urlsToConvert.length} selected documentation pages...`);

      const res = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          selectedUrls: urlsToConvert,
          documentTitle: documentTitle.trim() || siteTitle,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate PDF document.");
      }

      setResult(data);
      setStep("result");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to compile offline manual.");
      setStep("selection");
    }
  };

  const handleGeneratePDF = () => {
    // Preserve discovery order when submitting selected pages
    const orderedSelected = discoveredPages
      .map((p) => p.url)
      .filter((u) => selectedUrls.has(u));
    runConversion(orderedSelected.length > 0 ? orderedSelected : Array.from(selectedUrls));
  };

  const handleBackToSelection = () => {
    setError(null);
    setStep("selection");
  };

  const handleReset = () => {
    setStep("input");
    setUrl("");
    setError(null);
    setJobId(null);
    setSiteTitle("");
    setDocumentTitle("");
    setDiscoveredPages([]);
    setSelectedUrls(new Set());
    setDiscoveryWarnings([]);
    setSearchFilter("");
    setResult(null);
  };

  const getFilteredPages = (): DiscoveredPage[] => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return discoveredPages;
    return discoveredPages.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.url.toLowerCase().includes(q) ||
        (p.section && p.section.toLowerCase().includes(q))
    );
  };

  const filteredPages = getFilteredPages();
  const isPartialResult = result && result.failedPages.length > 0;
  const remainingCount = Math.max(totalToProcess - processedCount, 0);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between text-slate-900 font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center space-x-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
          >
            <span className="bg-blue-600 text-white font-bold text-sm px-2 py-0.5 rounded">DOCU</span>
            <span className="font-semibold text-slate-800 text-base">Offline Manual Converter</span>
          </button>
          <div className="text-xs text-slate-500 font-medium">
            Version 2.0
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-4 py-8 sm:py-10 w-full flex-grow">
        {/* Error notification */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-6 p-4 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm flex items-start justify-between gap-3"
          >
            <div className="flex items-start space-x-2">
              <span className="font-bold shrink-0">Error:</span>
              <span className="break-words">{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="text-red-600 hover:text-red-900 text-xs font-semibold shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* STEP 1: Input URL */}
        {step === "input" && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6 sm:p-8">
            <div className="text-center max-w-xl mx-auto mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Turn Technical Documentation Into an Offline PDF Manual
              </h1>
              <p className="mt-3 text-slate-600 text-sm sm:text-base leading-relaxed">
                Enter the URL of a supported public documentation website. Docu discovers pages within scope, extracts structured technical content, and generates a searchable PDF with a clickable table of contents.
              </p>
            </div>

            <form onSubmit={handleStartDiscovery} className="max-w-2xl mx-auto">
              <label
                htmlFor="doc-url"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-2"
              >
                Documentation Website URL
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="doc-url"
                  type="url"
                  required
                  placeholder="https://docs.python.org/3/tutorial/"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  aria-describedby="url-helper-text"
                  className="flex-grow px-4 py-2.5 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600 text-white font-medium px-6 py-2.5 rounded-md text-sm transition-colors whitespace-nowrap"
                >
                  Discover Pages
                </button>
              </div>
              <p id="url-helper-text" className="mt-2 text-xs text-slate-500">
                Supports public HTTP/HTTPS documentation sites. Internal/private network addresses are blocked.
              </p>

              {/* Free Plan Limits Info */}
              <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
                <div className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true"></span>
                  <span>Free Plan: Up to 20 pages per export • Searchable text • Clickable TOC</span>
                </div>
                <span>Deterministic • Zero AI • SSRF-Protected</span>
              </div>
            </form>
          </div>
        )}

        {/* STEP 2: Discovering */}
        {step === "discovering" && (
          <div
            role="status"
            aria-live="polite"
            className="bg-white border border-slate-200 rounded-lg p-8 sm:p-10 text-center max-w-xl mx-auto shadow-sm"
          >
            <div
              className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"
              aria-hidden="true"
            ></div>
            <h2 className="text-lg font-semibold text-slate-800">Discovering Documentation Pages</h2>
            <p className="text-sm text-slate-600 mt-2">{processingStatus}</p>
            <p className="text-xs text-slate-400 mt-4">
              State: <span className="font-mono text-slate-600">{backendState}</span> • Checking navigation hierarchies, sitemaps, and internal links within scope...
            </p>
          </div>
        )}

        {/* STEP 3: Page Selection */}
        {step === "selection" && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-4">
              <div className="min-w-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                  Discovered Documentation
                </span>
                <h2 className="text-xl font-bold text-slate-900 mt-0.5 truncate">{siteTitle}</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {discoveredPages.length} pages discovered in documentation scope
                </p>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="px-3 py-1.5 border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Select All (Max 20)
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="px-3 py-1.5 border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Clear Selection
                </button>
              </div>
            </div>

            {/* Custom Document Title & Page Filter */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="custom-doc-title"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Manual Cover Title
                </label>
                <input
                  id="custom-doc-title"
                  type="text"
                  maxLength={140}
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  placeholder={siteTitle}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label
                  htmlFor="page-filter"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Filter Discovered Pages
                </label>
                <input
                  id="page-filter"
                  type="search"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Filter by title, section, or path..."
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {discoveryWarnings.length > 0 && (
              <div
                role="status"
                className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900"
              >
                <span className="font-semibold">Discovery Warnings ({discoveryWarnings.length}):</span>{" "}
                {discoveryWarnings.slice(0, 3).join(" • ")}
              </div>
            )}

            {/* List of Pages */}
            <div
              role="group"
              aria-label="Discovered documentation pages"
              className="mt-4 max-h-96 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md"
            >
              {filteredPages.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No discovered pages match your filter &ldquo;{searchFilter}&rdquo;.
                </div>
              ) : (
                filteredPages.map((page, idx) => {
                  const isSelected = selectedUrls.has(page.url);
                  return (
                    <label
                      key={page.url}
                      className={`flex items-start p-3 cursor-pointer hover:bg-slate-50 transition-colors ${
                        isSelected ? "bg-blue-50/40" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => togglePageSelection(page.url)}
                        className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4 shrink-0"
                      />
                      <div className="ml-3 flex-grow min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="text-sm font-medium text-slate-900 break-words">
                            {idx + 1}. {page.title}
                          </span>
                          <div className="flex items-center space-x-1.5 shrink-0">
                            {page.section && (
                              <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[11px] font-medium">
                                {page.section}
                              </span>
                            )}
                            <span className="text-[11px] text-slate-400 font-mono">
                              depth {page.depth}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-slate-500 break-all mt-0.5">{page.url}</p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            {/* Selection Summary and Convert Action */}
            <div className="mt-6 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-slate-600" aria-live="polite">
                <span className="font-bold text-slate-900">{selectedUrls.size}</span> of{" "}
                {discoveredPages.length} pages selected
                {selectedUrls.size >= 20 && (
                  <span className="text-amber-700 ml-2 font-medium">
                    (Free tier 20-page limit reached)
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-3 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2 border border-slate-300 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-50 flex-1 sm:flex-none"
                >
                  Start Over
                </button>
                <button
                  type="button"
                  disabled={selectedUrls.size === 0}
                  onClick={handleGeneratePDF}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-md text-xs transition-colors flex-1 sm:flex-none"
                >
                  Generate PDF ({selectedUrls.size})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Processing */}
        {step === "processing" && (
          <div
            role="status"
            aria-live="polite"
            className="bg-white border border-slate-200 rounded-lg p-8 sm:p-10 text-center max-w-xl mx-auto shadow-sm"
          >
            <div
              className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"
              aria-hidden="true"
            ></div>
            <h2 className="text-lg font-semibold text-slate-800">Compiling Documentation Manual</h2>
            <p className="text-sm text-slate-600 mt-1">{processingStatus}</p>

            {/* Real Backend Counts */}
            <div className="mt-5 p-4 bg-slate-50 border border-slate-200 rounded-md max-w-md mx-auto">
              <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
                <span>
                  Backend State:{" "}
                  <strong className="font-mono text-slate-900">{backendState}</strong>
                </span>
                <span>
                  Processed:{" "}
                  <strong className="text-slate-900">
                    {processedCount} / {totalToProcess}
                  </strong>
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs pt-2 border-t border-slate-200">
                <div>
                  <span className="block text-slate-400">Processed</span>
                  <span className="font-bold text-slate-800">{processedCount}</span>
                </div>
                <div>
                  <span className="block text-slate-400">Remaining</span>
                  <span className="font-bold text-slate-800">{remainingCount}</span>
                </div>
                <div>
                  <span className="block text-slate-400">Failed</span>
                  <span className={`font-bold ${liveFailedCount > 0 ? "text-amber-700" : "text-slate-800"}`}>
                    {liveFailedCount}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-5 max-w-xs mx-auto text-xs text-slate-500 space-y-1 text-left">
              <p>• Extracting headings, code blocks, tables & callouts</p>
              <p>• Scaling supported diagrams proportionally</p>
              <p>• Generating clickable table of contents & PDF bookmarks</p>
            </div>
          </div>
        )}

        {/* STEP 5: Result */}
        {step === "result" && result && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6 sm:p-8">
            <div className="text-center pb-6 border-b border-slate-200">
              {isPartialResult ? (
                <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-100 text-amber-700 rounded-full mb-3">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
              ) : (
                <div className="inline-flex items-center justify-center w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full mb-3">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}

              <h2 className="text-2xl font-bold text-slate-900">
                {isPartialResult
                  ? "Partial Documentation Manual Ready"
                  : "Documentation Manual Ready"}
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                {isPartialResult
                  ? `Processed ${result.pagesExtracted} of ${result.pagesTotal} selected pages (${result.failedPages.length} failed and omitted).`
                  : `Successfully compiled all ${result.pagesExtracted} selected pages for ${documentTitle || siteTitle}.`}
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <a
                  href={result.downloadUrl}
                  download={result.fileName}
                  className={`inline-flex items-center space-x-2 ${
                    isPartialResult
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  } text-white font-medium px-6 py-3 rounded-md text-sm transition-colors shadow-sm`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>
                    Download {isPartialResult ? "Partial " : ""}PDF Manual
                    {result.pdfPageCount ? ` (${result.pdfPageCount} pages` : ""}
                    {result.fileSizeBytes
                      ? `${result.pdfPageCount ? ", " : " ("}${Math.max(1, Math.round(result.fileSizeBytes / 1024))} KB)`
                      : result.pdfPageCount
                      ? ")"
                      : ""}
                  </span>
                </a>
              </div>
            </div>

            {/* Processing Report */}
            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Conversion Report
                </h3>
                <span className="text-xs font-mono text-slate-500">
                  Status: {result.state}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                  <span className="block text-slate-500">Selected</span>
                  <span className="block text-base font-bold text-slate-800 mt-0.5">
                    {result.pagesTotal}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                  <span className="block text-slate-500">Succeeded</span>
                  <span className="block text-base font-bold text-emerald-700 mt-0.5">
                    {result.pagesExtracted}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                  <span className="block text-slate-500">Failed</span>
                  <span
                    className={`block text-base font-bold mt-0.5 ${
                      result.failedPages.length > 0 ? "text-red-600" : "text-slate-800"
                    }`}
                  >
                    {result.failedPages.length}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                  <span className="block text-slate-500">Warnings</span>
                  <span className="block text-base font-bold text-slate-800 mt-0.5">
                    {result.warnings.length}
                  </span>
                </div>
              </div>

              {/* Incomplete / Failed pages report if any */}
              {result.failedPages.length > 0 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
                  <span className="font-bold block mb-1.5">
                    Omitted / Failed Pages ({result.failedPages.length}):
                  </span>
                  <ul className="list-disc list-inside space-y-1 break-all">
                    {result.failedPages.map((fp, i) => (
                      <li key={i}>
                        <span className="font-mono font-medium">{fp.url}</span> — {fp.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings summary if any */}
              {result.warnings.length > 0 && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700">
                  <span className="font-bold block mb-1.5">
                    Processing & Resource Warnings ({result.warnings.length}):
                  </span>
                  <ul className="list-disc list-inside space-y-1 break-all max-h-32 overflow-y-auto">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="mt-8 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleBackToSelection}
                className="px-4 py-2 border border-slate-300 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-50 w-full sm:w-auto"
              >
                ← Modify Page Selection / Retry
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 w-full sm:w-auto text-center"
              >
                Convert Another Documentation Site →
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        <p>Docu — Deterministic Documentation to Offline PDF Converter • Respects site policies & copyright</p>
      </footer>
    </div>
  );
}
