import { describe, it, expect } from "vitest";
import { extractPageContent } from "../extractor";

describe("Content Extractor", () => {
  it("extracts structured content blocks, strips boilerplate/permalinks, and preserves links/code/tables/dl", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>API Reference | Acme</title></head>
        <body>
          <nav class="sidebar">
            <ul><li><a href="/docs">Overview</a></li></ul>
          </nav>
          <div class="cookie-banner">Please accept cookies</div>
          <main>
            <h1>Authentication API<a class="headerlink" href="#auth">¶</a></h1>
            <p>This endpoint issues bearer tokens for <a href="https://api.acme.com/v1">API requests</a>.</p>
            <div class="admonition note">
              <p>Keep your client secret secure and do not expose it in client code.</p>
            </div>
            <h2>Request Parameters</h2>
            <table class="parameters">
              <thead>
                <tr><th>Field</th><th>Type</th><th>Description</th></tr>
              </thead>
              <tbody>
                <tr><td>client_id</td><td>string</td><td>Your application client id</td></tr>
                <tr><td>grant_type</td><td>string</td><td>Must be client_credentials</td></tr>
              </tbody>
            </table>
            <dl>
              <dt>--timeout</dt>
              <dd>Maximum request timeout in milliseconds.</dd>
            </dl>
            <h3>Code Sample</h3>
            <pre><span class="linenos">1</span><code class="language-bash">curl -X POST https://api.acme.com/v1/oauth/token \\
  -d "grant_type=client_credentials"</code></pre>
            <ul>
              <li>HTTPS required
                <ul>
                  <li>TLS 1.2 or higher</li>
                </ul>
              </li>
              <li>Rate limit: 100 req/min</li>
            </ul>
            <img src="/assets/auth-flow.png" alt="Authentication Flow Diagram" />
          </main>
          <footer>Copyright 2026 Acme Corp</footer>
        </body>
      </html>
    `;

    const extracted = extractPageContent(html, "https://api.acme.com/docs/auth");

    expect(extracted.title).toBe("Authentication API");
    expect(extracted.blocks.length).toBeGreaterThan(0);

    // Check heading stripped of permalink symbol
    const h1 = extracted.blocks.find((b) => b.type === "heading" && b.level === 1);
    expect(h1).toBeDefined();
    if (h1 && h1.type === "heading") {
      expect(h1.text).toBe("Authentication API");
    }

    // Check paragraph and preserved inline link
    const p = extracted.blocks.find((b) => b.type === "paragraph");
    expect(p).toBeDefined();
    if (p && p.type === "paragraph") {
      expect(p.text).toContain("issues bearer tokens");
      expect(p.links).toEqual([{ text: "API requests", href: "https://api.acme.com/v1" }]);
    }

    // Check callout
    const callout = extracted.blocks.find((b) => b.type === "callout");
    expect(callout).toBeDefined();
    if (callout && callout.type === "callout") {
      expect(callout.variant).toBe("note");
      expect(callout.text).toContain("client secret secure");
    }

    // Check table
    const table = extracted.blocks.find((b) => b.type === "table");
    expect(table).toBeDefined();
    if (table && table.type === "table") {
      expect(table.headers).toContain("Field");
      expect(table.rows.length).toBe(2);
      expect(table.rows[0]).toContain("client_id");
    }

    // Check definition list term extracted
    const dtHeading = extracted.blocks.find(
      (b) => b.type === "heading" && b.level === 4 && b.text === "--timeout"
    );
    expect(dtHeading).toBeDefined();

    // Check code block (with .linenos stripped)
    const code = extracted.blocks.find((b) => b.type === "code");
    expect(code).toBeDefined();
    if (code && code.type === "code") {
      expect(code.code).toContain("curl -X POST");
      expect(code.code).not.toMatch(/^1curl/);
      expect(code.language).toBe("bash");
    }

    // Check top-level and nested lists
    const lists = extracted.blocks.filter((b) => b.type === "list");
    expect(lists.length).toBe(2);
    if (lists[0]?.type === "list" && lists[1]?.type === "list") {
      expect(lists[0].items).toContain("HTTPS required");
      expect(lists[0].items[0]).not.toContain("TLS 1.2");
      expect(lists[1].items).toContain("TLS 1.2 or higher");
      expect(lists[1].indent).toBe(1);
    }

    // Check image extraction
    const img = extracted.blocks.find((b) => b.type === "image");
    expect(img).toBeDefined();
    if (img && img.type === "image") {
      expect(img.src).toBe("https://api.acme.com/assets/auth-flow.png");
      expect(img.alt).toBe("Authentication Flow Diagram");
    }

    // Check that cookie banner and footer were stripped
    const fullText = JSON.stringify(extracted.blocks);
    expect(fullText).not.toContain("Please accept cookies");
    expect(fullText).not.toContain("Copyright 2026 Acme Corp");
  });

  it("handles empty or sparse pages gracefully with warnings", () => {
    const html = `<html><body><main></main></body></html>`;
    const extracted = extractPageContent(html, "https://example.com/empty");
    expect(extracted.blocks.length).toBe(0);
    expect(extracted.warnings.length).toBeGreaterThan(0);
  });
});
