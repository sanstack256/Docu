import { NextResponse } from "next/server";
import { z } from "zod";
import { safeFetch, SecurityError } from "@/lib/security";
import { isWithinDocScope, normalizeUrl } from "@/lib/crawler";
import { extractPageContent, enrichPageImages, ExtractedPage } from "@/lib/extractor";
import { generateDocumentationPDF } from "@/lib/pdf";
import { getJob, updateJob, finalizeJobWithPDF } from "@/lib/jobs";
import { getOrCreateSessionId, buildSessionCookieHeader } from "@/lib/session";
import { consumeExportQuota } from "@/lib/quota";
import { checkRateLimit, getClientIp, pruneStorageDirectory } from "@/lib/rateLimit";

const ConvertSchema = z.object({
  jobId: z.string().uuid("Invalid job identifier"),
  selectedUrls: z.array(z.string().url()).min(1, "At least one page must be selected"),
  documentTitle: z.string().max(140).optional(),
});

export async function POST(request: Request) {
  try {
    // 1. Rate Limiting Check (5 conversions per minute per IP)
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`convert:${clientIp}`, 6);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait a moment before starting another conversion." },
        { status: 429, headers: { "Retry-After": rateLimit.resetSeconds.toString() } }
      );
    }

    const json = await request.json();
    const parsed = ConvertSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input parameters." },
        { status: 400 }
      );
    }

    const { jobId, documentTitle } = parsed.data;
    const selectedUrls = Array.from(new Set(parsed.data.selectedUrls.map((u) => normalizeUrl(u))));

    // 2. Server-Enforced Session & Quota Check
    const { sessionId, isNew } = getOrCreateSessionId(request);
    const hasCustomTitle = Boolean(documentTitle && documentTitle.trim().length > 0);

    const quotaResult = consumeExportQuota(sessionId, selectedUrls.length, hasCustomTitle);
    if (!quotaResult.success) {
      return NextResponse.json(
        { error: quotaResult.error, plan: quotaResult.plan },
        { status: 403 }
      );
    }

    const job = getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found or has expired." }, { status: 404 });
    }

    // 3. Security check: ensure all selected URLs belong to the job's documentation scope
    for (const candidateUrl of selectedUrls) {
      if (!isWithinDocScope(candidateUrl, job.url)) {
        return NextResponse.json(
          { error: `Selected URL is outside the permitted documentation scope: ${candidateUrl}` },
          { status: 403 }
        );
      }
    }

    updateJob(jobId, {
      state: "processing",
      selectedPages: selectedUrls,
      totalSelected: selectedUrls.length,
      processedPages: 0,
      failedPages: [],
    });

    const orderedResults: Array<ExtractedPage | null> = new Array(selectedUrls.length).fill(null);
    const failedPages: Array<{ url: string; error: string }> = [];
    const allWarnings: string[] = [...job.warnings];
    let completedCount = 0;

    // Concurrency: Pro gets priority 4 concurrent, Free gets 2 concurrent
    const concurrency = quotaResult.plan === "pro" ? 4 : 2;

    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < selectedUrls.length) {
        const currentIndex = nextIndex++;
        const pageUrl = selectedUrls[currentIndex];

        try {
          const fetchRes = await safeFetch(pageUrl, { timeoutMs: 12000, retries: 1 });
          if (fetchRes.status >= 400) {
            failedPages.push({ url: pageUrl, error: `HTTP status ${fetchRes.status}` });
          } else {
            const contentType = fetchRes.headers.get("content-type") || "";
            if (
              contentType &&
              !contentType.includes("text/html") &&
              !contentType.includes("application/xhtml+xml") &&
              !contentType.includes("text/plain")
            ) {
              failedPages.push({ url: pageUrl, error: `Unsupported content-type: ${contentType}` });
            } else {
              const html = await fetchRes.text();
              const extracted = extractPageContent(html, pageUrl);
              await enrichPageImages(extracted, 3);
              if (extracted.warnings.length > 0) {
                allWarnings.push(...extracted.warnings);
              }
              orderedResults[currentIndex] = extracted;
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          failedPages.push({ url: pageUrl, error: msg });
        }

        completedCount++;
        updateJob(jobId, {
          processedPages: completedCount,
          failedPages: [...failedPages],
          warnings: [...allWarnings],
        });
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, selectedUrls.length) },
      () => worker()
    );
    await Promise.all(workers);

    const extractedPages = orderedResults.filter((p): p is ExtractedPage => p !== null);

    if (extractedPages.length === 0) {
      updateJob(jobId, {
        state: "failed",
        error: "All selected pages failed to download or extract.",
        failedPages,
        warnings: allWarnings,
      });
      return NextResponse.json(
        {
          error: "All selected pages failed to extract.",
          failedPages,
        },
        { status: 422 }
      );
    }

    // Generate PDF
    updateJob(jobId, {
      state: "generating_pdf",
      failedPages,
      warnings: allWarnings,
    });

    const safeSiteName = (documentTitle || job.siteTitle || "documentation")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase()
      .slice(0, 50) || "documentation";
    const fileName = `${safeSiteName}-manual-${Date.now().toString().slice(-6)}.pdf`;

    const { buffer, pageCount } = await generateDocumentationPDF({
      siteTitle: job.siteTitle,
      sourceUrl: job.url,
      pages: extractedPages,
      documentTitle: hasCustomTitle ? documentTitle?.trim() : undefined,
      failedPages,
      warnings: allWarnings,
    });

    const finalizedJob = finalizeJobWithPDF(jobId, buffer, fileName);
    if (!finalizedJob) {
      return NextResponse.json({ error: "Failed to finalize generated PDF file." }, { status: 500 });
    }

    // Prune storage in background
    try {
      pruneStorageDirectory();
    } catch {
      // Ignore
    }

    const response = NextResponse.json({
      jobId,
      state: finalizedJob.state,
      downloadToken: finalizedJob.downloadToken,
      downloadUrl: `/api/download/${finalizedJob.downloadToken}`,
      fileName,
      fileSizeBytes: finalizedJob.fileSizeBytes,
      pdfPageCount: pageCount,
      pagesTotal: selectedUrls.length,
      pagesExtracted: extractedPages.length,
      failedPages,
      warnings: allWarnings,
      quotaRemaining: quotaResult.remaining,
      plan: quotaResult.plan,
    });

    if (isNew) {
      response.headers.set("Set-Cookie", buildSessionCookieHeader(sessionId));
    }

    return response;
  } catch (err: unknown) {
    if (err instanceof SecurityError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "Failed to generate PDF document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
