import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const jobId = params.id;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found or expired." }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    url: job.url,
    siteTitle: job.siteTitle,
    state: job.state,
    processedPages: job.processedPages,
    totalSelected: job.totalSelected,
    failedPages: job.failedPages,
    warnings: job.warnings,
    error: job.error,
    downloadToken: job.downloadToken,
    fileSizeBytes: job.fileSizeBytes,
  });
}

