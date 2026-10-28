import { describe, it, expect } from "vitest";
import {
  normalizeUrl,
  getCanonicalDedupKey,
  isWithinDocScope,
  extractLinksAndTitle,
} from "../crawler";

describe("Crawler & Scope Filtering", () => {
  describe("normalizeUrl & getCanonicalDedupKey", () => {
    it("strips hash fragments", () => {
      expect(normalizeUrl("https://example.com/docs#heading-1")).toBe("https://example.com/docs");
      expect(normalizeUrl("https://example.com/docs/#intro")).toBe("https://example.com/docs");
    });

    it("removes marketing and tracking query parameters and sorts remaining params", () => {
      const url = "https://example.com/docs?z=2&utm_source=twitter&a=1&ref=producthunt";
      const normalized = normalizeUrl(url);
      expect(normalized).toBe("https://example.com/docs?a=1&z=2");
    });

    it("normalizes redundant slashes and trailing slash", () => {
      expect(normalizeUrl("https://example.com/docs/guide/")).toBe("https://example.com/docs/guide");
      expect(normalizeUrl("https://example.com///docs//guide")).toBe("https://example.com/docs/guide");
    });

    it("produces matching canonical deduplication keys for /index.html and directory root", () => {
      expect(getCanonicalDedupKey("https://docs.example.com/3/tutorial/index.html")).toBe(
        getCanonicalDedupKey("https://docs.example.com/3/tutorial/")
      );
      expect(getCanonicalDedupKey("https://docs.example.com/index.htm")).toBe(
        getCanonicalDedupKey("https://docs.example.com/")
      );
    });
  });

  describe("isWithinDocScope", () => {
    const root = "https://docs.example.com/guide";

    it("allows pages within the same base path", () => {
      expect(isWithinDocScope("https://docs.example.com/guide/intro", root)).toBe(true);
      expect(isWithinDocScope("https://docs.example.com/guide/advanced/setup", root)).toBe(true);
      expect(isWithinDocScope("https://docs.example.com/guide", root)).toBe(true);
    });

    it("rejects pages outside base path", () => {
      expect(isWithinDocScope("https://docs.example.com/blog/news", root)).toBe(false);
      expect(isWithinDocScope("https://docs.example.com/pricing", root)).toBe(false);
    });

    it("rejects different origins and subdomains", () => {
      expect(isWithinDocScope("https://example.com/guide/intro", root)).toBe(false);
      expect(isWithinDocScope("https://api.example.com/guide/intro", root)).toBe(false);
      expect(isWithinDocScope("http://docs.example.com/guide/intro", root)).toBe(false);
    });

    it("rejects binary and media file extensions", () => {
      expect(isWithinDocScope("https://docs.example.com/guide/manual.pdf", root)).toBe(false);
      expect(isWithinDocScope("https://docs.example.com/guide/diagram.png", root)).toBe(false);
      expect(isWithinDocScope("https://docs.example.com/guide/archive.zip", root)).toBe(false);
    });
  });

  describe("extractLinksAndTitle", () => {
    it("extracts clean title without permalink markers and prioritizes navigation links with titles", () => {
      const sampleHtml = `
        <!DOCTYPE html>
        <html>
          <head><title>Getting Started - MyProject Docs</title></head>
          <body>
            <header><a href="/home">Home</a></header>
            <nav class="sidebar">
              <h3>Core Concepts</h3>
              <ul>
                <li><a href="/guide/install">1. Installation Guide</a></li>
                <li><a href="configuration.html">2. Configuration Reference</a></li>
              </ul>
            </nav>
            <main>
              <h1>Getting Started<a class="headerlink" href="#getting-started">¶</a></h1>
              <p>Read the <a href="/guide/install">install docs</a> or visit <a href="https://external.com">External</a>.</p>
              <a href="#section">Anchor</a>
              <a href="mailto:docs@example.com">Email</a>
            </main>
          </body>
        </html>
      `;

      const result = extractLinksAndTitle(sampleHtml, "https://docs.example.com/guide/intro");
      expect(result.title).toBe("Getting Started");
      expect(result.links).toContain("https://docs.example.com/guide/install");
      expect(result.links).toContain("https://docs.example.com/guide/configuration.html");
      expect(result.links).toContain("https://external.com/");

      // Verify navigation link was prioritized and retained its descriptive title
      const installDetail = result.detailedLinks.find(
        (d) => d.url === "https://docs.example.com/guide/install"
      );
      expect(installDetail).toBeDefined();
      expect(installDetail?.isNav).toBe(true);
      expect(installDetail?.title).toBe("1. Installation Guide");

      // Anchors, mailto, etc. excluded
      expect(result.links.some((l) => l.includes("mailto"))).toBe(false);
      expect(result.links.some((l) => l.includes("#section"))).toBe(false);
    });
  });
});
