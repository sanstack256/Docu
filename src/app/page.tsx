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
  quotaRemaining?: number;
  plan?: string;
}

interface QuotaStatus {
  plan: "free" | "pro";
  exportsUsed: number;
  exportsRemaining: number;
  maxExports: number;
  maxPagesPerExport: number;
  allowsCustomTitle: boolean;
  cycleRenewalDate: string;
  hasActiveSubscription: boolean;
}

type Step = "input" | "discovering" | "selection" | "processing" | "result";

export default function DocuApp() {
  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Billing & Quota state
  const [quota, setQuota] = useState<QuotaStatus>({
    plan: "free",
    exportsUsed: 0,
    exportsRemaining: 2,
    maxExports: 2,
    maxPagesPerExport: 20,
    allowsCustomTitle: false,
    cycleRenewalDate: "",
    hasActiveSubscription: false,
  });
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [isBillingLoading, setIsBillingLoading] = useState(false);

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

  // Fetch billing quota status on mount and inspect URL params
  useEffect(() => {
    const fetchQuota = async () => {
      try {
        const res = await fetch("/api/billing/status", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setQuota(data);
        }
      } catch {
        // Ignore initial billing fetch error
      }
    };

    fetchQuota();

    // Check for success or cancel URL params from checkout/portal
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("upgraded") === "true") {
        setToastMessage("Welcome to Docu Pro! Your 20 monthly exports, 500-page limit, and custom titles are active.");
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (params.get("canceled_sub") === "true") {
        setToastMessage("Your Pro subscription has been canceled. Your account has returned to the Free plan.");
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, []);

  // Poll actual backend job state during conversion
  useEffect(() => {
    if (step !== "processing" || !jobId) return;

    let active = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (res.status === 404) {
          active = false;
          clearInterval(interval);
          return;
        }
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
          setProcessingStatus("Fetching and extracting content pages...");
        }
      } catch {
        // Ignore transient polling errors
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

    let trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a website or documentation URL.");
      return;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(trimmed)) {
      trimmed = `https://${trimmed}`;
    }

    try {
      setStep("discovering");
      setBackendState("discovering");
      setProcessingStatus("Validating URL and inspecting page structure...");

      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to discover pages for this website.");
      }

      const pages: DiscoveredPage[] = data.pages || [];
      if (pages.length === 0) {
        throw new Error("No accessible pages were found within scope for this URL.");
      }

      const resolvedTitle = data.siteTitle || new URL(trimmed).hostname;
      setJobId(data.jobId);
      setSiteTitle(resolvedTitle);
      setDocumentTitle(resolvedTitle);
      setDiscoveredPages(pages);
      setDiscoveryWarnings(data.warnings || []);
      setSearchFilter("");

      // Select discovered pages up to user's plan limit
      const maxSelect = quota.maxPagesPerExport || 20;
      const initialSelected = new Set<string>();
      pages.slice(0, maxSelect).forEach((p: DiscoveredPage) => initialSelected.add(p.url));
      setSelectedUrls(initialSelected);

      setStep("selection");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred during discovery.");
      setStep("input");
    }
  };

  const togglePageSelection = (pageUrl: string) => {
    const maxSelect = quota.maxPagesPerExport || 20;
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(pageUrl)) {
        next.delete(pageUrl);
      } else {
        if (next.size >= maxSelect) {
          setError(
            `${quota.plan.toUpperCase()} plan limit: A maximum of ${maxSelect} pages can be selected per export.${
              quota.plan === "free" ? " Upgrade to Pro for up to 500 pages." : ""
            }`
          );
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
    const maxSelect = quota.maxPagesPerExport || 20;
    const next = new Set<string>();
    const filtered = getFilteredPages();
    for (const p of filtered) {
      if (next.size >= maxSelect) break;
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
      setProcessingStatus(`Extracting ${urlsToConvert.length} selected pages...`);

      const res = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          selectedUrls: urlsToConvert,
          documentTitle: quota.allowsCustomTitle ? (documentTitle.trim() || siteTitle) : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate PDF document.");
      }

      setResult(data);
      if (typeof data.quotaRemaining === "number") {
        setQuota((prev) => ({
          ...prev,
          exportsRemaining: data.quotaRemaining,
          exportsUsed: prev.maxExports - data.quotaRemaining,
        }));
      }
      setStep("result");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to compile offline manual.");
      setStep("selection");
    }
  };

  const handleGeneratePDF = () => {
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

  const handleCheckoutPro = async () => {
    try {
      setIsBillingLoading(true);
      setError(null);
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to initiate checkout");
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Checkout error occurred.");
    } finally {
      setIsBillingLoading(false);
    }
  };

  const handleOpenPortal = async () => {
    try {
      setIsBillingLoading(true);
      setError(null);
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to open portal");
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Customer portal error occurred.");
    } finally {
      setIsBillingLoading(false);
    }
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

          <div className="flex items-center space-x-3 text-xs">
            {quota.plan === "pro" ? (
              <div className="flex items-center space-x-2">
                <span className="bg-emerald-100 text-emerald-800 font-semibold px-2.5 py-1 rounded-full border border-emerald-200">
                  PRO Plan ({quota.exportsRemaining} exports left)
                </span>
                <button
                  type="button"
                  onClick={handleOpenPortal}
                  disabled={isBillingLoading}
                  className="text-slate-600 hover:text-slate-900 font-medium underline"
                >
                  Manage
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <span className="bg-slate-100 text-slate-700 font-medium px-2.5 py-1 rounded-full border border-slate-200">
                  Free ({quota.exportsRemaining}/2 exports left)
                </span>
                <button
                  type="button"
                  onClick={() => setShowPricingModal(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-3 py-1 rounded shadow-sm transition-colors"
                >
                  Upgrade ($12/mo)
                </button>
              </div>
            )}
            <span className="text-slate-400 font-mono hidden sm:inline">v3.0</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-4 py-8 sm:py-10 w-full flex-grow">
        {/* Toast confirmation */}
        {toastMessage && (
          <div
            role="status"
            className="mb-6 p-4 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm flex items-start justify-between gap-3 shadow-sm"
          >
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}

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
                Turn Public Websites Into Offline PDF Manuals
              </h1>
              <p className="mt-3 text-slate-600 text-sm sm:text-base leading-relaxed">
                Enter the URL of technical documentation, an editorial guide, or an informational website. Docu discovers pages within scope, extracts clean content without advertisements or duplicate navigation, and generates a structured, searchable PDF with a clickable table of contents.
              </p>
            </div>

            <form onSubmit={handleStartDiscovery} className="max-w-2xl mx-auto">
              <label
                htmlFor="doc-url"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-2"
              >
                Website or Documentation URL
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="doc-url"
                  type="text"
                  inputMode="url"
                  required
                  placeholder="https://docs.python.org/3/tutorial/ or en.wikipedia.org"
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
                Supports public HTTP/HTTPS websites. Private and link-local IP addresses are blocked for security.
              </p>

              {/* Tier comparison strip */}
              <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
                <div className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true"></span>
                  <span>
                    {quota.plan === "pro"
                      ? "Pro Plan: 20 exports/mo • Up to 500 pages/export • Custom Titles"
                      : `Free Plan: 2 exports/mo (${quota.exportsRemaining} remaining) • Up to 20 pages/export`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPricingModal(true)}
                  className="text-blue-600 hover:underline font-medium"
                >
                  View Plan Details & Pricing →
                </button>
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
            <h2 className="text-lg font-semibold text-slate-800">Discovering Pages</h2>
            <p className="text-sm text-slate-600 mt-2">{processingStatus}</p>
            <p className="text-xs text-slate-400 mt-4">
              State: <span className="font-mono text-slate-600">{backendState}</span> • Evaluating documentation scope, sitemaps, and internal links...
            </p>
          </div>
        )}

        {/* STEP 3: Page Selection */}
        {step === "selection" && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-4">
              <div className="min-w-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                  Discovered Content Scope
                </span>
                <h2 className="text-xl font-bold text-slate-900 mt-0.5 truncate">{siteTitle}</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {discoveredPages.length} pages discovered within scope
                </p>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="px-3 py-1.5 border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Select All (Max {quota.maxPagesPerExport})
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

            {/* Document Title & Filter */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="custom-doc-title" className="block text-xs font-medium text-slate-700">
                    Manual Cover Title
                  </label>
                  {!quota.allowsCustomTitle && (
                    <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                      Pro Feature
                    </span>
                  )}
                </div>
                <input
                  id="custom-doc-title"
                  type="text"
                  maxLength={140}
                  disabled={!quota.allowsCustomTitle}
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  placeholder={siteTitle}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                />
                {!quota.allowsCustomTitle && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    Free tier uses default website title. Upgrade to Pro for custom title editing.
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="page-filter" className="block text-xs font-medium text-slate-700 mb-1">
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
                <strong className="font-semibold block mb-1">Discovery Notices:</strong>
                <ul className="list-disc pl-4 space-y-0.5">
                  {discoveryWarnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Page Checklist */}
            <div className="mt-4 border border-slate-200 rounded-md divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {filteredPages.length === 0 ? (
                <div className="p-4 text-xs text-slate-500 text-center">
                  No pages match your search filter.
                </div>
              ) : (
                filteredPages.map((page) => {
                  const isChecked = selectedUrls.has(page.url);
                  return (
                    <label
                      key={page.url}
                      className={`flex items-start p-3 hover:bg-slate-50 cursor-pointer text-xs select-none ${
                        isChecked ? "bg-blue-50/50" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePageSelection(page.url)}
                        className="mt-0.5 h-4 w-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <div className="ml-3 min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-slate-900 truncate">{page.title}</span>
                          {page.section && (
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] shrink-0">
                              {page.section}
                            </span>
                          )}
                        </div>
                        <span className="text-slate-400 font-mono text-[10px] block truncate">
                          {page.path}
                        </span>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            {/* Selection Footer */}
            <div className="mt-5 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-slate-600">
                <span className="font-bold text-slate-900">{selectedUrls.size}</span> of{" "}
                {discoveredPages.length} pages selected
                {selectedUrls.size >= quota.maxPagesPerExport && (
                  <span className="text-amber-700 ml-2 font-medium">
                    ({quota.plan.toUpperCase()} tier {quota.maxPagesPerExport}-page limit reached)
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
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-md text-xs transition-colors flex-1 sm:flex-none shadow-sm"
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
            <h2 className="text-lg font-semibold text-slate-800">Compiling Offline Manual</h2>
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
              <p>• Extracting structured headings, text, and code blocks</p>
              <p>• Preserving tables, figures, and image captions</p>
              <p>• Generating clickable table of contents & vector bookmarks</p>
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
                  ? "Partial Offline Manual Ready"
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
                  target="_self"
                  rel="noopener noreferrer"
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

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                  <span className="block text-xs text-slate-500">Selected</span>
                  <span className="text-lg font-bold text-slate-800">{result.pagesTotal}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                  <span className="block text-xs text-slate-500">Succeeded</span>
                  <span className="text-lg font-bold text-emerald-600">{result.pagesExtracted}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                  <span className="block text-xs text-slate-500">Failed</span>
                  <span className={`text-lg font-bold ${result.failedPages.length > 0 ? "text-amber-600" : "text-slate-800"}`}>
                    {result.failedPages.length}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                  <span className="block text-xs text-slate-500">Warnings</span>
                  <span className="text-lg font-bold text-slate-800">{result.warnings.length}</span>
                </div>
              </div>

              {result.failedPages.length > 0 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-md text-xs">
                  <strong className="text-amber-900 font-semibold block mb-1">
                    Failed Pages (Excluded from PDF manual):
                  </strong>
                  <ul className="list-disc pl-4 space-y-1 text-amber-800">
                    {result.failedPages.map((f, i) => (
                      <li key={i}>
                        <span className="font-mono">{f.url}</span>: {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.warnings.length > 0 && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-md text-xs">
                  <strong className="text-slate-700 font-semibold block mb-1">
                    Extraction Notices:
                  </strong>
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-600 max-h-40 overflow-y-auto">
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
                className="px-4 py-2 border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50 w-full sm:w-auto"
              >
                ← Modify Page Selection / Retry
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-blue-600 hover:underline font-medium"
              >
                Convert Another Website →
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Pricing Modal */}
      {showPricingModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 border border-slate-200 relative">
            <button
              type="button"
              onClick={() => setShowPricingModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 font-bold text-lg"
              aria-label="Close"
            >
              ×
            </button>

            <h2 className="text-xl font-bold text-slate-900 mb-1">Docu Plans & Quotas</h2>
            <p className="text-xs text-slate-500 mb-6">
              Straightforward pricing for software developers and engineering teams.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Free Plan */}
              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Free</span>
                  <div className="text-2xl font-bold text-slate-900 mt-1">$0</div>
                  <p className="text-xs text-slate-500 mt-0.5">Free forever</p>
                  <ul className="mt-4 space-y-2 text-xs text-slate-700">
                    <li className="flex items-center space-x-1.5">
                      <span className="text-emerald-600">✓</span>
                      <span>2 exports per 30 days</span>
                    </li>
                    <li className="flex items-center space-x-1.5">
                      <span className="text-emerald-600">✓</span>
                      <span>Up to 20 pages per export</span>
                    </li>
                    <li className="flex items-center space-x-1.5">
                      <span className="text-emerald-600">✓</span>
                      <span>Clickable Table of Contents</span>
                    </li>
                    <li className="flex items-center space-x-1.5 text-slate-400">
                      <span>✕</span>
                      <span>Default cover title only</span>
                    </li>
                  </ul>
                </div>
                <div className="mt-6">
                  <span className="block text-center text-xs font-semibold text-slate-500 py-2 border border-slate-200 rounded bg-white">
                    {quota.plan === "free" ? "Current Plan" : "Included"}
                  </span>
                </div>
              </div>

              {/* Pro Plan */}
              <div className="p-4 rounded-lg border-2 border-blue-600 bg-blue-50/20 flex flex-col justify-between relative shadow-sm">
                <span className="absolute -top-2.5 right-4 bg-blue-600 text-white font-bold text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Recommended
                </span>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-600">Pro</span>
                  <div className="text-2xl font-bold text-slate-900 mt-1">
                    $12 <span className="text-xs font-normal text-slate-500">/ month</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Cancel anytime</p>
                  <ul className="mt-4 space-y-2 text-xs text-slate-700">
                    <li className="flex items-center space-x-1.5">
                      <span className="text-emerald-600 font-bold">✓</span>
                      <span><strong>20 exports</strong> per 30 days</span>
                    </li>
                    <li className="flex items-center space-x-1.5">
                      <span className="text-emerald-600 font-bold">✓</span>
                      <span><strong>Up to 500 pages</strong> / export</span>
                    </li>
                    <li className="flex items-center space-x-1.5">
                      <span className="text-emerald-600 font-bold">✓</span>
                      <span><strong>Custom cover titles</strong></span>
                    </li>
                    <li className="flex items-center space-x-1.5">
                      <span className="text-emerald-600 font-bold">✓</span>
                      <span>Priority conversion worker</span>
                    </li>
                  </ul>
                </div>
                <div className="mt-6">
                  {quota.plan === "pro" ? (
                    <button
                      type="button"
                      onClick={handleOpenPortal}
                      disabled={isBillingLoading}
                      className="w-full text-center text-xs font-semibold text-blue-700 py-2 border border-blue-300 rounded bg-blue-50 hover:bg-blue-100 transition-colors"
                    >
                      Manage Subscription
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCheckoutPro}
                      disabled={isBillingLoading}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs py-2 rounded shadow-sm transition-colors"
                    >
                      {isBillingLoading ? "Redirecting..." : "Upgrade to Pro ($12/mo)"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <p className="text-[10px] text-slate-400 mt-5 text-center">
              Secured payments via Stripe. Test sandbox mode available in development environments.
            </p>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500 bg-white">
        <p>Docu — Universal Deterministic Offline Manual Converter • Respects site policies & copyright</p>
      </footer>
    </div>
  );
}
