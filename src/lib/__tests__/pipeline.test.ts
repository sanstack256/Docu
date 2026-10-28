import { describe, it, expect } from "vitest";
import { extractPageContent } from "../extractor";
import { generateDocumentationPDF } from "../pdf";
import { createJob, updateJob, finalizeJobWithPDF, getPDFByDownloadToken } from "../jobs";

describe("End-to-End Pipeline Integration", () => {
  it("orchestrates job creation, extraction, PDF rendering, and token-based download", async () => {
    // 1. Create Job
    const rootUrl = "https://example.org/docs";
    const job = createJob(rootUrl);
    expect(job.id).toBeDefined();
    expect(job.state).toBe("queued");

    // 2. Mock discovered pages
    const mockHtmlPage1 = `
      <html>
        <head><title>Getting Started</title></head>
        <body>
          <main>
            <h1>Getting Started</h1>
            <p>Welcome to Version 1 of Docu.</p>
            <pre><code>npm install docu</code></pre>
          </main>
        </body>
      </html>
    `;

    const mockHtmlPage2 = `
      <html>
        <head><title>API Usage</title></head>
        <body>
          <main>
            <h1>API Usage</h1>
            <p>Here is how to query the endpoints safely.</p>
          </main>
        </body>
      </html>
    `;

    const p1 = extractPageContent(mockHtmlPage1, "https://example.org/docs/start");
    const p2 = extractPageContent(mockHtmlPage2, "https://example.org/docs/api");

    updateJob(job.id, {
      state: "processing",
      selectedPages: [p1.url, p2.url],
      totalSelected: 2,
      processedPages: 2,
    });

    // 3. Generate PDF
    const { buffer, pageCount } = await generateDocumentationPDF({
      siteTitle: "Example Project",
      sourceUrl: rootUrl,
      pages: [p1, p2],
    });

    expect(pageCount).toBeGreaterThanOrEqual(3);

    // 4. Finalize Job
    const finalized = finalizeJobWithPDF(job.id, buffer, "example-manual.pdf");
    expect(finalized?.state).toBe("completed");
    expect(finalized?.downloadToken).toBeDefined();

    // 5. Retrieve PDF via Token
    const download = getPDFByDownloadToken(finalized!.downloadToken!);
    expect(download).toBeDefined();
    expect(download?.fileName).toBe("example-manual.pdf");
    expect(download?.buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
