import { describe, it, expect } from "vitest";
import { extractPageContent } from "../extractor";

describe("Content Extractor", () => {
  it("extracts structured content blocks and filters out boilerplate", () => {
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
            <h1>Authentication API</h1>
            <p>This endpoint issues bearer tokens for API requests.</p>
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
            <h3>Code Sample</h3>
            <pre><code class="language-bash">curl -X POST https://api.acme.com/v1/oauth/token \\
  -d "grant_type=client_credentials"</code></pre>
            <ul>
              <li>HTTPS required</li>
              <li>Rate limit: 100 req/min</li>
            </ul>
          </main>
          <footer>Copyright 2026 Acme Corp</footer>
        </body>
      </html>
    `;

    const extracted = extractPageContent(html, "https://api.acme.com/docs/auth");

    expect(extracted.title).toBe("Authentication API");
    expect(extracted.blocks.length).toBeGreaterThan(0);

    // Check heading
    const h1 = extracted.blocks.find((b) => b.type === "heading" && b.level === 1);
    expect(h1).toBeDefined();
    if (h1 && h1.type === "heading") {
      expect(h1.text).toBe("Authentication API");
    }

    // Check paragraph
    const p = extracted.blocks.find((b) => b.type === "paragraph");
    expect(p).toBeDefined();
    if (p && p.type === "paragraph") {
      expect(p.text).toContain("issues bearer tokens");
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

    // Check code block
    const code = extracted.blocks.find((b) => b.type === "code");
    expect(code).toBeDefined();
    if (code && code.type === "code") {
      expect(code.code).toContain("curl -X POST");
      expect(code.language).toBe("bash");
    }

    // Check list
    const list = extracted.blocks.find((b) => b.type === "list");
    expect(list).toBeDefined();
    if (list && list.type === "list") {
      expect(list.items).toContain("HTTPS required");
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
