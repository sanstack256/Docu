import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { extractPageContent, ExtractedPage } from "../extractor";
import { generateDocumentationPDF } from "../pdf";

describe("Diverse Web Structure Extraction & PDF Corpus Tests", () => {
  // 1. Long-form editorial article with figure and caption
  it("extracts long-form editorial articles and captures figure captions", () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>The Architecture of Scalable Systems — TechBlog</title>
        <meta property="og:title" content="The Architecture of Scalable Systems">
      </head>
      <body>
        <nav class="site-nav"><a href="/">Home</a><a href="/archive">Archive</a></nav>
        <div class="ad-wrapper"><div class="advertisement">Buy Something!</div></div>
        <article class="post-content">
          <h1>The Architecture of Scalable Systems</h1>
          <p class="lead">Building distributed systems requires understanding reliability, availability, and partitions.</p>
          <h2>Core Principles</h2>
          <p>Every distributed architecture must balance state replication and data durability across nodes.</p>
          <figure>
            <img src="https://example.com/assets/diagram.png" alt="Node Cluster Topology">
            <figcaption>Figure 1: Two-phase commit topology across three primary replicas.</figcaption>
          </figure>
          <blockquote>Systems fail in unexpected ways. Always design for recovery.</blockquote>
          <p>For more details, visit the <a href="https://example.com/consensus">Consensus Overview</a>.</p>
        </article>
        <div class="author-bio">Written by Jane Doe, Principal Architect.</div>
        <div class="comments" id="comments">Comment section here.</div>
        <footer class="site-footer">© 2026 TechBlog Inc.</footer>
      </body>
      </html>
    `;

    const page = extractPageContent(html, "https://example.com/posts/scalable-systems");

    expect(page.title).toBe("The Architecture of Scalable Systems");
    expect(page.isExcerpt).toBeFalsy();

    // Verify main content is extracted
    const headings = page.blocks.filter((b) => b.type === "heading");
    expect(headings.some((h) => h.text === "Core Principles")).toBe(true);

    // Verify figure with caption
    const imageBlock = page.blocks.find((b) => b.type === "image");
    expect(imageBlock).toBeDefined();
    if (imageBlock && imageBlock.type === "image") {
      expect(imageBlock.src).toBe("https://example.com/assets/diagram.png");
      expect(imageBlock.caption).toContain("Figure 1: Two-phase commit topology");
    }

    // Verify callout/quote
    const quote = page.blocks.find((b) => b.type === "callout");
    expect(quote).toBeDefined();
    if (quote && quote.type === "callout") {
      expect(quote.text).toContain("Systems fail in unexpected ways");
    }

    // Verify strip selectors eliminated promo/nav/author/comments
    const fullExtractedText = JSON.stringify(page.blocks);
    expect(fullExtractedText).not.toContain("Buy Something!");
    expect(fullExtractedText).not.toContain("Written by Jane Doe");
    expect(fullExtractedText).not.toContain("Comment section here");
    expect(fullExtractedText).not.toContain("© 2026 TechBlog Inc.");
  });

  // 2. Technical documentation page with nested headings, code snippets, and dl tags
  it("extracts technical documentation with code blocks and definition lists", () => {
    const html = `
      <div class="document">
        <div class="rst-content">
          <h1>Python Concurrency Guide</h1>
          <p>Python provides several modules for asynchronous execution.</p>
          <h2>Asyncio Basics</h2>
          <p>Here is how to create a simple coroutine:</p>
          <pre><code class="language-python">import asyncio

async def main():
    print("Hello from async!")

asyncio.run(main())</code></pre>
          <h2>Key Terminology</h2>
          <dl>
            <dt>Event Loop</dt>
            <dd>The central execution mechanism that manages and distributes execution of different tasks.</dd>
            <dt>Future</dt>
            <dd>An object representing the eventual result of an asynchronous operation.</dd>
          </dl>
          <div class="admonition warning">
            <p>Do not block the event loop with synchronous disk I/O.</p>
          </div>
        </div>
      </div>
    `;

    const page = extractPageContent(html, "https://docs.python.org/3/library/asyncio.html");
    expect(page.title).toBe("Python Concurrency Guide");

    const codeBlock = page.blocks.find((b) => b.type === "code");
    expect(codeBlock).toBeDefined();
    if (codeBlock && codeBlock.type === "code") {
      expect(codeBlock.language).toBe("python");
      expect(codeBlock.code).toContain("asyncio.run(main())");
    }

    const termHeadings = page.blocks.filter((b) => b.type === "heading" && b.text === "Event Loop");
    expect(termHeadings.length).toBe(1);

    const callout = page.blocks.find((b) => b.type === "callout" && b.variant === "warning");
    expect(callout).toBeDefined();
    if (callout && callout.type === "callout") {
      expect(callout.text).toContain("Do not block the event loop");
    }
  });

  // 3. Wide tables with headers and multi-column rows
  it("extracts wide tables preserving headers and column rows", () => {
    const html = `
      <article class="markdown-body">
        <h1>HTTP Status Codes Reference</h1>
        <p>A reference table of common HTTP response codes.</p>
        <table>
          <thead>
            <tr>
              <th>Status Code</th>
              <th>Reason Phrase</th>
              <th>Category</th>
              <th>RFC Specification</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>200</td>
              <td>OK</td>
              <td>Successful</td>
              <td>RFC 9110</td>
            </tr>
            <tr>
              <td>404</td>
              <td>Not Found</td>
              <td>Client Error</td>
              <td>RFC 9110</td>
            </tr>
            <tr>
              <td>503</td>
              <td>Service Unavailable</td>
              <td>Server Error</td>
              <td>RFC 9110</td>
            </tr>
          </tbody>
        </table>
      </article>
    `;

    const page = extractPageContent(html, "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status");
    const tableBlock = page.blocks.find((b) => b.type === "table");
    expect(tableBlock).toBeDefined();
    if (tableBlock && tableBlock.type === "table") {
      expect(tableBlock.headers).toEqual(["Status Code", "Reason Phrase", "Category", "RFC Specification"]);
      expect(tableBlock.rows.length).toBe(3);
      expect(tableBlock.rows[0]).toEqual(["200", "OK", "Successful", "RFC 9110"]);
    }
  });

  // 4. Repeated navigation, sidebars, cookie banners, advertisements
  it("filters out repeated navigation, sidebar menus, and promotional widgets", () => {
    const html = `
      <div id="cookie-banner" class="cookie-banner">Accept all tracking cookies?</div>
      <header class="header"><div class="menu">Navigation Links</div></header>
      <div class="sidebar">
        <ul class="nav"><li><a href="/1">Link 1</a></li><li><a href="/2">Link 2</a></li></ul>
      </div>
      <div class="main-content">
        <h1>Clean Report Page</h1>
        <p>This is the authentic primary content that must be preserved and rendered.</p>
      </div>
      <aside class="advertisement">Sponsored: Check out our cloud hosting!</aside>
      <div class="newsletter-signup">Join our daily email newsletter</div>
      <footer class="footer">Footer information</footer>
    `;

    const page = extractPageContent(html, "https://news.example.org/clean-report");
    expect(page.title).toBe("Clean Report Page");
    expect(page.blocks.length).toBeGreaterThan(0);

    const fullText = JSON.stringify(page.blocks);
    expect(fullText).not.toContain("Accept all tracking cookies");
    expect(fullText).not.toContain("Sponsored: Check out our cloud hosting");
    expect(fullText).not.toContain("Join our daily email newsletter");
    expect(fullText).not.toContain("Footer information");
    expect(fullText).toContain("This is the authentic primary content");
  });

  // 5. Excerpt / paywall teaser detection
  it("accurately detects and warns on article stubs and excerpts", () => {
    const html = `
      <article>
        <h1>Market Analysis Preview</h1>
        <p>The global semiconductor market experienced unexpected shifts this quarter...</p>
        <p>Subscribe to read the full story and access in-depth analysis.</p>
      </article>
    `;

    const page = extractPageContent(html, "https://journal.example.com/market-analysis-preview");
    expect(page.isExcerpt).toBe(true);
    expect(page.warnings.some((w) => w.includes("excerpt or summary"))).toBe(true);
  });

  // 6. Insufficient or malformed content
  it("reports pages where main content cannot be reliably identified", () => {
    const html = `
      <html>
        <body>
          <div class="empty"></div>
        </body>
      </html>
    `;

    const page = extractPageContent(html, "https://example.com/blank");
    expect(page.blocks.length).toBe(0);
    expect(page.warnings.some((w) => w.includes("Main content could not be reliably identified"))).toBe(true);
  });

  // 7. Full multi-page PDF generation test from diverse corpus
  it("generates a high-quality PDF containing table of contents, bookmarks, and no raw image URLs", async () => {
    const p1: ExtractedPage = {
      url: "https://example.com/chapter1",
      title: "Introduction to Distributed Systems",
      blocks: [
        { type: "heading", level: 2, text: "Background and Motivation" },
        {
          type: "paragraph",
          text: "Distributed systems consist of autonomous compute nodes communicating over networks.",
          links: [{ text: "Network Topology", href: "https://example.com/topology" }],
        },
        {
          type: "image",
          src: "https://example.com/assets/diagram.svg",
          caption: "High level architectural topology",
        },
      ],
      wordCount: 45,
      warnings: [],
    };

    const p2: ExtractedPage = {
      url: "https://example.com/chapter2",
      title: "Data Models & Schemas",
      blocks: [
        { type: "heading", level: 2, text: "Relational vs Document" },
        {
          type: "table",
          headers: ["Attribute", "Relational", "Document"],
          rows: [
            ["Schema Enforcement", "Strict DDL", "Dynamic / Flexible"],
            ["Transactions", "ACID", "Tunable Eventual Consistency"],
          ],
        },
      ],
      wordCount: 30,
      warnings: [],
    };

    const result = await generateDocumentationPDF({
      siteTitle: "Distributed Systems Manual",
      sourceUrl: "https://example.com",
      documentTitle: "Distributed Systems Manual — Offline Edition",
      pages: [p1, p2],
    });

    expect(result.pageCount).toBeGreaterThanOrEqual(3); // Cover, TOC, Chapter 1, Chapter 2
    expect(result.buffer.byteLength).toBeGreaterThan(1000);

    // Verify PDF header
    expect(result.buffer.slice(0, 5).toString("utf-8")).toBe("%PDF-");

    // Decompress and verify PDF text streams
    const pdfRaw = result.buffer.toString("binary");
    const streamMatches = [...pdfRaw.matchAll(/stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g)];
    let decompressedAll = "";
    let extractedText = "";

    for (const match of streamMatches) {
      try {
        const streamData = Buffer.from(match[1], "binary");
        const decompressed = zlib.inflateSync(streamData).toString("utf-8");
        decompressedAll += decompressed;

        // Decode PDF text operators (both literal Tj and hex-encoded TJ)
        const tjMatches = decompressed.matchAll(/\[(.*?)\]\s*TJ/g);
        for (const m of tjMatches) {
          const hexParts = m[1].matchAll(/<([0-9a-fA-F]+)>/g);
          let itemStr = "";
          for (const h of hexParts) {
            itemStr += Buffer.from(h[1], "hex").toString("latin1");
          }
          extractedText += itemStr + " ";
        }
        const literalMatches = decompressed.matchAll(/\((.*?)\)\s*Tj/g);
        for (const m of literalMatches) {
          extractedText += m[1] + " ";
        }
      } catch {
        // Uncompressed or font dictionary stream
      }
    }

    // Verify headings and TOC are in the output
    expect(extractedText).toContain("Distributed Systems");
    expect(extractedText).toContain("Table of Contents");
    expect(extractedText).toContain("Background and Motivation");
    expect(extractedText).toContain("Relational vs Document");
    expect(extractedText).toContain("Schema Enforcement");

    // Verify no raw image URL appears in the text stream
    expect(decompressedAll).not.toContain("https://example.com/assets/diagram.svg");
    expect(extractedText).not.toContain("https://example.com/assets/diagram.svg");
    // Verify clean illustration reference is used instead
    expect(extractedText).toContain("Illustration: High level architectural topology");
  });
});
