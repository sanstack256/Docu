import { NextResponse } from "next/server";
import { z } from "zod";
import { validateUrlStructure, assertSafeDestination, normalizeInputUrl, SecurityError } from "@/lib/security";
import { discoverPages } from "@/lib/crawler";
import { createJob, updateJob } from "@/lib/jobs";
import { getOrCreateSessionId, buildSessionCookieHeader } from "@/lib/session";
import { getQuotaStatus } from "@/lib/quota";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const DiscoverSchema = z.object({
  url: z.string().min(1, "URL is required"),
});

export async function POST(request: Request) {
  try {
    // 1. Rate Limiting Check (15 discovery requests per minute per IP)
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`discover:${clientIp}`, 15);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait a moment before discovering another site." },
        { status: 429, headers: { "Retry-After": rateLimit.resetSeconds.toString() } }
      );
    }

    const json = await request.json();
    const parsed = DiscoverSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input parameters." },
        { status: 400 }
      );
    }

    const targetUrl = normalizeInputUrl(parsed.data.url);

    // 2. Security validation: URL structure and SSRF check
    const validUrl = validateUrlStructure(targetUrl);
    await assertSafeDestination(validUrl);

    // 3. User session & entitlement
    const { sessionId, isNew } = getOrCreateSessionId(request);
    const quota = getQuotaStatus(sessionId);
    const maxDiscoveryPages = quota.plan === "pro" ? 100 : 20;

    // 4. Create tracking job
    const job = createJob(validUrl.href);
    updateJob(job.id, { state: "discovering" });

    // 5. Execute discovery
    const result = await discoverPages(validUrl.href, { maxPages: maxDiscoveryPages, maxDepth: 3 });

    updateJob(job.id, {
      state: "awaiting_selection",
      siteTitle: result.siteTitle,
      discoveredPages: result.pages,
      warnings: result.warnings,
    });

    const response = NextResponse.json({
      jobId: job.id,
      rootUrl: result.rootUrl,
      siteTitle: result.siteTitle,
      pages: result.pages,
      warnings: result.warnings,
      plan: quota.plan,
      maxSelectable: quota.maxPagesPerExport,
    });

    if (isNew) {
      response.headers.set("Set-Cookie", buildSessionCookieHeader(sessionId));
    }

    return response;
  } catch (err: unknown) {
    console.error("[DISCOVER ERROR]:", err);
    if (err instanceof SecurityError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "Failed to discover documentation pages.";
    const isClientError = /resolve DNS|Invalid domain|Invalid URL|ECONNREFUSED|ENOTFOUND|timed out/i.test(message);
    return NextResponse.json({ error: message }, { status: isClientError ? 400 : 500 });
  }
}
