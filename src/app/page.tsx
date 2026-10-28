"use client";

import React, { useState } from "react";

interface DiscoveredPage {
  url: string;
  title: string;
  path: string;
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

  // Discovery state
  const [jobId, setJobId] = useState<string | null>(null);
  const [siteTitle, setSiteTitle] = useState("");
  const [discoveredPages, setDiscoveredPages] = useState<DiscoveredPage[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [discoveryWarnings, setDiscoveryWarnings] = useState<string[]>([]);

  // Processing state
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [processedCount, setProcessedCount] = useState<number>(0);
  const [totalToProcess, setTotalToProcess] = useState<number>(0);

  // Result state
  const [result, setResult] = useState<ConversionResult | null>(null);

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

      setJobId(data.jobId);
      setSiteTitle(data.siteTitle || new URL(trimmed).hostname);
      setDiscoveredPages(data.pages || []);
      setDiscoveryWarnings(data.warnings || []);

      // By default, select all discovered pages (up to 20 for free tier)
      const initialSelected = new Set<string>();
      (data.pages || []).slice(0, 20).forEach((p: DiscoveredPage) => initialSelected.add(p.url));
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
          setError("Free plan limit: Maximum 20 pages can be selected per export.");
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
    discoveredPages.slice(0, 20).forEach((p) => next.add(p.url));
    setSelectedUrls(next);
  };

  const handleDeselectAll = () => {
    setError(null);
    setSelectedUrls(new Set());
  };

  const handleGeneratePDF = async () => {
    if (!jobId || selectedUrls.size === 0) return;
    setError(null);

    try {
      setStep("processing");
      setTotalToProcess(selectedUrls.size);
      setProcessedCount(0);
      setProcessingStatus(`Extracting ${selectedUrls.size} selected documentation pages...`);

      const res = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          selectedUrls: Array.from(selectedUrls),
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

  const handleReset = () => {
    setStep("input");
    setUrl("");
    setError(null);
    setJobId(null);
    setDiscoveredPages([]);
    setSelectedUrls(new Set());
    setResult(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between text-slate-900 font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="bg-blue-600 text-white font-bold text-sm px-2 py-0.5 rounded">DOCU</span>
            <span className="font-semibold text-slate-800 text-base">Offline Manual Converter</span>
          </div>
          <div className="text-xs text-slate-500 font-medium">
            Version 1.0 (MVP)
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-4 py-10 w-full flex-grow">
        {/* Error notification */}
        {error && (
          <div className="mb-6 p-4 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm flex items-start space-x-2">
            <span className="font-bold">Error:</span>
            <span>{error}</span>
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
                Enter the URL of any supported public documentation site. Docu safely crawls the pages, extracts clean technical content, and produces a structured, searchable PDF with a clickable table of contents.
              </p>
            </div>

            <form onSubmit={handleStartDiscovery} className="max-w-2xl mx-auto">
              <label htmlFor="doc-url" className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-2">
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
                  className="flex-grow px-4 py-2.5 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-md text-sm transition-colors whitespace-nowrap"
                >
                  Discover Pages
                </button>
              </div>

              {/* Free Plan Limits Info */}
              <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
                <div className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>Free Plan: Up to 20 pages per export • Searchable text • Table of contents</span>
                </div>
                <span>Deterministic • Zero AI • SSRF-Protected</span>
              </div>
            </form>
          </div>
        )}

        {/* STEP 2: Discovering */}
        {step === "discovering" && (
          <div className="bg-white border border-slate-200 rounded-lg p-10 text-center max-w-xl mx-auto shadow-sm">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
            <h2 className="text-lg font-semibold text-slate-800">Discovering Documentation Pages</h2>
            <p className="text-sm text-slate-600 mt-2">{processingStatus}</p>
            <p className="text-xs text-slate-400 mt-4">Checking sitemaps, navigation hierarchies, and internal links within scope...</p>
          </div>
        )}

        {/* STEP 3: Page Selection */}
        {step === "selection" && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-600">Discovered Documentation</span>
                <h2 className="text-xl font-bold text-slate-900 mt-0.5">{siteTitle}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{discoveredPages.length} pages found in scope</p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="px-3 py-1.5 border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Select All (Max 20)
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="px-3 py-1.5 border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Clear Selection
                </button>
              </div>
            </div>

            {discoveryWarnings.length > 0 && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                <span className="font-semibold">Discovery Notice:</span> {discoveryWarnings.join(" • ")}
              </div>
            )}

            {/* List of Pages */}
            <div className="mt-5 max-h-96 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md">
              {discoveredPages.map((page, idx) => {
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
                      className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                    />
                    <div className="ml-3 flex-grow min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-900 truncate">
                          {idx + 1}. {page.title}
                        </span>
                        <span className="text-xs text-slate-400 font-mono ml-2">depth: {page.depth}</span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{page.url}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Selection Summary and Convert Action */}
            <div className="mt-6 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-slate-600">
                <span className="font-bold text-slate-900">{selectedUrls.size}</span> of {discoveredPages.length} pages selected
                {selectedUrls.size >= 20 && (
                  <span className="text-amber-600 ml-2 font-medium">(Free plan maximum reached)</span>
                )}
              </div>
              <div className="flex items-center space-x-3 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2 border border-slate-300 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-50 flex-1 sm:flex-none"
                >
                  Cancel
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
          <div className="bg-white border border-slate-200 rounded-lg p-10 text-center max-w-xl mx-auto shadow-sm">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
            <h2 className="text-lg font-semibold text-slate-800">Compiling Documentation Manual</h2>
            <p className="text-sm text-slate-600 mt-2">{processingStatus}</p>
            <div className="mt-5 max-w-xs mx-auto text-xs text-slate-500 space-y-1">
              <p>• Extracting semantic headings, code blocks & tables</p>
              <p>• Formatting typography and monospace indentation</p>
              <p>• Building clickable table of contents & page numbers</p>
            </div>
          </div>
        )}

        {/* STEP 5: Result */}
        {step === "result" && result && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6 sm:p-8">
            <div className="text-center pb-6 border-b border-slate-200">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full mb-3">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">Documentation Manual Ready</h2>
              <p className="text-sm text-slate-600 mt-1">
                Successfully processed {result.pagesExtracted} of {result.pagesTotal} pages for {siteTitle}.
              </p>
              <div className="mt-4">
                <a
                  href={result.downloadUrl}
                  download={result.fileName}
                  className="inline-flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-6 py-3 rounded-md text-sm transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Download PDF Manual {result.fileSizeBytes ? `(${Math.round(result.fileSizeBytes / 1024)} KB)` : ""}</span>
                </a>
              </div>
            </div>

            {/* Processing Report */}
            <div className="mt-6 space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">Conversion Report</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                  <span className="block text-slate-500">Selected</span>
                  <span className="block text-base font-bold text-slate-800 mt-0.5">{result.pagesTotal}</span>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                  <span className="block text-slate-500">Extracted</span>
                  <span className="block text-base font-bold text-emerald-700 mt-0.5">{result.pagesExtracted}</span>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                  <span className="block text-slate-500">Failed</span>
                  <span className="block text-base font-bold text-slate-800 mt-0.5">{result.failedPages.length}</span>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                  <span className="block text-slate-500">Warnings</span>
                  <span className="block text-base font-bold text-slate-800 mt-0.5">{result.warnings.length}</span>
                </div>
              </div>

              {/* Incomplete / Failed pages report if any */}
              {result.failedPages.length > 0 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
                  <span className="font-bold block mb-1">Failed Pages ({result.failedPages.length}):</span>
                  <ul className="list-disc list-inside space-y-1">
                    {result.failedPages.map((fp, i) => (
                      <li key={i}>
                        <span className="font-mono">{fp.url}</span>: {fp.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="mt-8 pt-4 border-t border-slate-200 text-center">
              <button
                type="button"
                onClick={handleReset}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800"
              >
                ← Convert Another Documentation Site
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
        <p>Docu — Deterministic Documentation to Offline PDF Converter • Open Source</p>
      </footer>
    </div>
  );
}
