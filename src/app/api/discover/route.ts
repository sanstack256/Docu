import { NextResponse } from "next/server";
import { z } from "zod";
import { validateUrlStructure, assertSafeDestination, normalizeInputUrl, SecurityError } from "@/lib/security";
import { discoverPages } from "@/lib/crawler";
import { createJob, updateJob } from "@/lib/jobs";

const DiscoverSchema = z.object({
  url: z.string().min(1, "URL is required"),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = DiscoverSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input parameters." },
        { status: 400 }
      );
    }

    const targetUrl = normalizeInputUrl(parsed.data.url);

    // Security validation: URL structure and SSRF check
    const validUrl = validateUrlStructure(targetUrl);
    await assertSafeDestination(validUrl);

    // Create tracking job
    const job = createJob(validUrl.href);
    updateJob(job.id, { state: "discovering" });

    // Execute discovery (Max 20 pages for Free tier)
    const result = await discoverPages(validUrl.href, { maxPages: 20, maxDepth: 3 });

    updateJob(job.id, {
      state: "awaiting_selection",
      siteTitle: result.siteTitle,
      discoveredPages: result.pages,
      warnings: result.warnings,
    });

    return NextResponse.json({
      jobId: job.id,
      rootUrl: result.rootUrl,
      siteTitle: result.siteTitle,
      pages: result.pages,
      warnings: result.warnings,
    });
  } catch (err: unknown) {
    if (err instanceof SecurityError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "Failed to discover documentation pages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
