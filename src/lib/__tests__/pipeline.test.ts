import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { extractPageContent } from "../extractor";
import { generateDocumentationPDF } from "../pdf";
import { createJob, updateJob, finalizeJobWithPDF, getPDFByDownloadToken } from "../jobs";

/**
 * Extracts and decompresses all FlateDecode streams in a PDF buffer and decodes
 * hex-encoded TJ text operators so tests can inspect the actual rendered PDF text.
 */
function decompressPdfTextStreams(pdfBuffer: Buffer): string {
  const raw = pdfBuffer.toString("latin1");
  const decodedChunks: string[] = [raw];

  let cursor = 0;
  while (cursor < raw.length) {
    const streamStart = raw.indexOf("stream\n", cursor);
    if (streamStart === -1) break;
    const dataStart = streamStart + 7;
    const streamEnd = raw.indexOf("\nendstream", dataStart);
    if (streamEnd === -1) break;

    const compressedSlice = pdfBuffer.subarray(dataStart, streamEnd);
    try {
      const inflated = zlib.inflateSync(compressedSlice).toString("latin1");
      decodedChunks.push(inflated);

      // Reconstruct continuous strings from PDFKit [<hex> kern <hex> ...] TJ arrays
      const tjMatches = inflated.match(/\[[^\]]+\]\s*TJ/g) || [];
      for (const tj of tjMatches) {
        const hexParts = tj.match(/<([0-9a-fA-F]+)>/g) || [];
        const textLine = hexParts
          .map((h) => Buffer.from(h.slice(1, -1), "hex").toString("latin1"))
          .join("");
        decodedChunks.push(textLine);
      }
    } catch {
      // Not a zlib stream or uncompressed
    }
    cursor = streamEnd + 10;
  }

  return decodedChunks.join("\n");
}

describe("End-to-End Pipeline Integration", () => {
  it("orchestrates job creation, extraction, PDF rendering, and verifies decompressed PDF text content", async () => {
    // 1. Create Job
    const rootUrl = "https://example.org/docs";
    const job = createJob(rootUrl);
    expect(job.id).toBeDefined();
    expect(job.state).toBe("queued");

    // 2. Extract realistic multi-page documentation HTML
    const mockHtmlPage1 = `
      <html>
        <head><title>Getting Started — Example Docs</title></head>
        <body>
          <main>
            <h1>Getting Started<a class="headerlink" href="#start">¶</a></h1>
            <p>Welcome to Version 2 of Docu. Visit <a href="https://example.org/docs/install">Installation</a>.</p>
            <h2>Quick Installation</h2>
            <pre><code class="language-bash">npm install docu-cli --save</code></pre>
          </main>
        </body>
      </html>
    `;

    const mockHtmlPage2 = `
      <html>
        <head><title>API Usage — Example Docs</title></head>
        <body>
          <main>
            <h1>API Usage</h1>
            <h2>Endpoint Reference</h2>
            <p>Here is how to query the endpoints safely.</p>
            <table>
              <thead><tr><th>Header</th><th>Required</th></tr></thead>
              <tbody><tr><td>X-Docu-Token</td><td>Yes</td></tr></tbody>
            </table>
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

    expect(pageCount).toBeGreaterThanOrEqual(4);

    // Decompress PDF streams and verify actual source content is rendered in the PDF
    const decodedPdf = decompressPdfTextStreams(buffer);
    expect(decodedPdf).toContain("Table of Contents");
    expect(decodedPdf).toContain("Getting Started");
    expect(decodedPdf).toContain("Quick Installation");
    expect(decodedPdf).toContain("npm install docu-cli --save");
    expect(decodedPdf).toContain("Endpoint Reference");
    expect(decodedPdf).toContain("X-Docu-Token");
    expect(decodedPdf).toContain("Page 2 of");

    // 4. Finalize Job
    const finalized = finalizeJobWithPDF(job.id, buffer, "example-manual.pdf");
    expect(finalized?.state).toBe("completed");
    expect(finalized?.downloadToken).toBeDefined();

    // 5. Retrieve PDF via Token
    const download = getPDFByDownloadToken(finalized!.downloadToken!);
    expect(download).toBeDefined();
    expect(download?.fileName).toBe("example-manual.pdf");
    expect(download?.buffer.subarray(0, 5).toString()).toBe("%PDF-");

    // 6. Verify disk recovery resilience (even if in-memory cache is wiped)
    if (globalThis.__docu_tokens) {
      globalThis.__docu_tokens.delete(finalized!.downloadToken!);
    }
    const recoveredFromDisk = getPDFByDownloadToken(finalized!.downloadToken!);
    expect(recoveredFromDisk).toBeDefined();
    expect(recoveredFromDisk?.fileName).toBe("example-manual.pdf");
    expect(recoveredFromDisk?.buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
