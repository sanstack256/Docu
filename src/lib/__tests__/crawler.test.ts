import { describe, it, expect } from "vitest";
import {
  normalizeUrl,
  isWithinDocScope,
  extractLinksAndTitle,
} from "../crawler";

describe("Crawler & Scope Filtering", () => {
  describe("normalizeUrl", () => {
    it("strips hash fragments", () => {
      expect(normalizeUrl("https://example.com/docs#heading-1")).toBe("https://example.com/docs");
      expect(normalizeUrl("https://example.com/docs/#intro")).toBe("https://example.com/docs");
    });

    it("removes marketing and tracking query parameters", () => {
      const url = "https://example.com/docs?utm_source=twitter&utm_medium=social&ref=producthunt&page=1";
      const normalized = normalizeUrl(url);
      expect(normalized).toBe("https://example.com/docs?page=1");
    });

    it("normalizes redundant slashes and trailing slash", () => {
      expect(normalizeUrl("https://example.com/docs/guide/")).toBe("https://example.com/docs/guide");
      expect(normalizeUrl("https://example.com///docs//guide")).toBe("https://example.com/docs/guide");
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
    it("extracts clean title and resolves internal links", () => {
      const sampleHtml = `
        <!DOCTYPE html>
        <html>
          <head><title>Getting Started - MyProject Docs</title></head>
          <body>
            <header><a href="/home">Home</a></header>
            <main>
              <h1>Getting Started</h1>
              <a href="/guide/install">Installation</a>
              <a href="configuration.html">Configuration</a>
              <a href="https://external.com">External</a>
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
      // Anchors, mailto, etc. excluded
      expect(result.links.some((l) => l.includes("mailto"))).toBe(false);
      expect(result.links.some((l) => l.includes("#section"))).toBe(false);
    });
  });
});
