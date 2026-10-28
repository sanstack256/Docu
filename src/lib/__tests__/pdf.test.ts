import { describe, it, expect } from "vitest";
import { generateDocumentationPDF } from "../pdf";
import { ExtractedPage } from "../extractor";

describe("PDF Generator", () => {
  it("generates a valid, searchable PDF buffer with title, TOC, and content", async () => {
    const pages: ExtractedPage[] = [
      {
        url: "https://docs.example.com/guide/intro",
        title: "Introduction",
        blocks: [
          { type: "heading", level: 1, text: "Introduction" },
          { type: "paragraph", text: "Welcome to the offline manual. This document contains comprehensive technical instructions." },
          { type: "code", code: "const docu = new DocuConverter();\nawait docu.convert();", language: "typescript" },
          { type: "callout", variant: "tip", text: "You can download this manual for offline use anytime." },
        ],
        wordCount: 30,
        warnings: [],
      },
      {
        url: "https://docs.example.com/guide/config",
        title: "Configuration",
        blocks: [
          { type: "heading", level: 1, text: "Configuration" },
          { type: "paragraph", text: "Settings can be passed via environment variables or JSON configuration." },
          {
            type: "table",
            headers: ["Option", "Type", "Default"],
            rows: [
              ["port", "number", "3000"],
              ["timeout", "number", "10000"],
            ],
          },
          { type: "list", ordered: true, items: ["Create config file", "Set environment variables", "Restart worker"] },
        ],
        wordCount: 35,
        warnings: [],
      },
    ];

    const result = await generateDocumentationPDF({
      siteTitle: "Example Docs",
      sourceUrl: "https://docs.example.com/guide",
      pages,
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.byteLength).toBeGreaterThan(1000);

    // Standard PDF file header
    const header = result.buffer.subarray(0, 5).toString("utf-8");
    expect(header).toBe("%PDF-");

    // Multiple pages: cover + TOC + 2 content pages
    expect(result.pageCount).toBeGreaterThanOrEqual(3);

    // Verify searchable text is embedded in the PDF byte stream
    const pdfContent = result.buffer.toString("latin1");
    expect(pdfContent).toContain("Docu");
    expect(pdfContent).toContain("Example Docs");
  });
});
