import { describe, it, expect } from "vitest";
import { generateDocumentationPDF, getImageDimensions } from "../pdf";
import { ExtractedPage } from "../extractor";

// Minimal valid 1x1 transparent PNG buffer
const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SAMPLE_PNG_BUFFER = Buffer.from(SAMPLE_PNG_BASE64, "base64");

describe("PDF Generator", () => {
  it("reads PNG image dimensions accurately", () => {
    const dims = getImageDimensions(SAMPLE_PNG_BUFFER);
    expect(dims).toEqual({ width: 1, height: 1 });
  });

  it("generates a valid, searchable PDF buffer with clickable TOC, multi-page code blocks, tables, and images", async () => {
    const longCode = Array.from(
      { length: 85 },
      (_, idx) => `const step${idx + 1} = await pipeline.executeStage(${idx + 1}, { retry: true });`
    ).join("\n");

    const tableRows = Array.from({ length: 35 }, (_, idx) => [
      `OPT_${idx + 1}`,
      "string",
      `default_${idx + 1}`,
      `Configures parameter ${idx + 1} for deterministic execution across worker processes.`,
    ]);

    const pages: ExtractedPage[] = [
      {
        url: "https://docs.example.com/guide/intro",
        title: "Introduction",
        blocks: [
          { type: "heading", level: 1, text: "Introduction" },
          { type: "heading", level: 2, text: "Architecture Overview" },
          {
            type: "paragraph",
            text: "Welcome to the offline manual. This document contains comprehensive technical instructions.",
            links: [{ text: "Official Spec", href: "https://docs.example.com/spec" }],
          },
          { type: "code", code: longCode, language: "typescript" },
          { type: "callout", variant: "tip", text: "You can download this manual for offline use anytime." },
          {
            type: "image",
            src: "https://docs.example.com/assets/diagram.png",
            alt: "System Architecture Diagram",
            data: SAMPLE_PNG_BUFFER,
          },
          {
            type: "image",
            src: "https://docs.example.com/assets/flow.svg",
            alt: "Vector Flow Diagram",
          },
        ],
        wordCount: 300,
        warnings: [],
      },
      {
        url: "https://docs.example.com/guide/config",
        title: "Configuration",
        blocks: [
          { type: "heading", level: 1, text: "Configuration" },
          { type: "heading", level: 2, text: "Environment Variables" },
          { type: "paragraph", text: "Settings can be passed via environment variables or JSON configuration." },
          {
            type: "table",
            headers: ["Option", "Type", "Default", "Description"],
            rows: tableRows,
          },
          { type: "list", ordered: true, items: ["Create config file", "Set environment variables", "Restart worker"] },
        ],
        wordCount: 250,
        warnings: [],
      },
    ];

    const result = await generateDocumentationPDF({
      siteTitle: "Example Docs",
      sourceUrl: "https://docs.example.com/guide",
      pages,
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.byteLength).toBeGreaterThan(2000);

    // Standard PDF file header
    const header = result.buffer.subarray(0, 5).toString("utf-8");
    expect(header).toBe("%PDF-");

    // Multiple pages: cover + TOC + multi-page code & multi-page table
    expect(result.pageCount).toBeGreaterThanOrEqual(5);

    // Verify metadata, named destinations, and links in the PDF stream
    const pdfContent = result.buffer.toString("latin1");
    expect(pdfContent).toContain("Docu");
    expect(pdfContent).toContain("Example Docs");
    expect(pdfContent).toContain("chapter_1");
    expect(pdfContent).toContain("https://docs.example.com/spec");
  });

  it("labels partial exports honestly when failedPages are provided", async () => {
    const pages: ExtractedPage[] = [
      {
        url: "https://docs.example.com/guide/intro",
        title: "Introduction",
        blocks: [{ type: "paragraph", text: "Available section content." }],
        wordCount: 3,
        warnings: [],
      },
    ];

    const result = await generateDocumentationPDF({
      siteTitle: "Example Docs",
      sourceUrl: "https://docs.example.com/guide",
      pages,
      failedPages: [{ url: "https://docs.example.com/guide/missing", error: "HTTP status 500" }],
    });

    const pdfContent = result.buffer.toString("latin1");
    expect(pdfContent).toContain("[Partial] Offline Documentation for Example Docs");
  });
});
