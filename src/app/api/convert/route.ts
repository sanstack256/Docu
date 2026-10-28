import { NextResponse } from "next/server";
import { z } from "zod";
import { safeFetch, SecurityError } from "@/lib/security";
import { extractPageContent, ExtractedPage } from "@/lib/extractor";
import { generateDocumentationPDF } from "@/lib/pdf";
import { getJob, updateJob, finalizeJobWithPDF } from "@/lib/jobs";

const ConvertSchema = z.object({
  jobId: z.string().uuid("Invalid job identifier"),
  selectedUrls: z.array(z.string().url()).min(1, "At least one page must be selected"),
  documentTitle: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = ConvertSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input parameters." },
        { status: 400 }
      );
    }

    const { jobId, selectedUrls, documentTitle } = parsed.data;

    // Enforce Free plan limit: max 20 selected pages per export
    if (selectedUrls.length > 20) {
      return NextResponse.json(
        { error: "Free tier limit exceeded: A maximum of 20 pages can be selected per export." },
        { status: 400 }
      );
    }

    const job = getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found or has expired." }, { status: 404 });
    }

    updateJob(jobId, {
      state: "processing",
      selectedPages: selectedUrls,
      totalSelected: selectedUrls.length,
      processedPages: 0,
      failedPages: [],
    });

    const extractedPages: ExtractedPage[] = [];
    const failedPages: Array<{ url: string; error: string }> = [];
    const allWarnings: string[] = [...job.warnings];

    // Process each selected page
    for (let i = 0; i < selectedUrls.length; i++) {
      const pageUrl = selectedUrls[i];
      try {
        const fetchRes = await safeFetch(pageUrl, { timeoutMs: 12000 });
        if (fetchRes.status >= 400) {
          failedPages.push({ url: pageUrl, error: `HTTP status ${fetchRes.status}` });
        } else {
          const html = await fetchRes.text();
          const extracted = extractPageContent(html, pageUrl);
          if (extracted.warnings.length > 0) {
            allWarnings.push(...extracted.warnings);
          }
          extractedPages.push(extracted);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        failedPages.push({ url: pageUrl, error: msg });
      }

      updateJob(jobId, {
        processedPages: i + 1,
        failedPages,
      });
    }

    if (extractedPages.length === 0) {
      updateJob(jobId, {
        state: "failed",
        error: "All selected pages failed to download or extract.",
        failedPages,
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
    updateJob(jobId, { state: "generating_pdf" });

    const safeSiteName = (job.siteTitle || "documentation").replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    const fileName = `${safeSiteName}-manual-${Date.now().toString().slice(-6)}.pdf`;

    const { buffer } = await generateDocumentationPDF({
      siteTitle: job.siteTitle,
      sourceUrl: job.url,
      pages: extractedPages,
      documentTitle,
    });

    const finalizedJob = finalizeJobWithPDF(jobId, buffer, fileName);
    if (!finalizedJob) {
      return NextResponse.json({ error: "Failed to finalize generated PDF file." }, { status: 500 });
    }

    return NextResponse.json({
      jobId,
      state: finalizedJob.state,
      downloadToken: finalizedJob.downloadToken,
      downloadUrl: `/api/download/${finalizedJob.downloadToken}`,
      fileName,
      fileSizeBytes: finalizedJob.fileSizeBytes,
      pagesTotal: selectedUrls.length,
      pagesExtracted: extractedPages.length,
      failedPages,
      warnings: allWarnings,
    });
  } catch (err: unknown) {
    if (err instanceof SecurityError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "Failed to generate PDF document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
