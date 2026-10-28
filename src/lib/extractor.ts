import * as cheerio from "cheerio";
type CheerioRoot = ReturnType<typeof cheerio.load>;

export type ContentBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; code: string; language?: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "callout"; variant: "note" | "tip" | "warning" | "caution" | "info"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "image"; src: string; alt?: string }
  | { type: "hr" };

export interface ExtractedPage {
  url: string;
  title: string;
  blocks: ContentBlock[];
  wordCount: number;
  warnings: string[];
}

const STRIP_SELECTORS = [
  "script", "style", "noscript", "iframe",
  "nav", "header", "footer",
  ".sidebar", ".navigation", ".menu", ".nav",
  ".cookie-banner", ".cookie-notice", ".cookie-consent",
  ".advertisement", ".ad", ".banner",
  ".social-share", ".share-buttons",
  ".toc", ".table-of-contents", ".page-toc",
  "button", "form", "input",
];

const MAIN_CONTAINER_SELECTORS = [
  "main",
  "article",
  "[role='main']",
  ".markdown-body",
  ".documentation-content",
  ".documentation",
  ".docs-content",
  ".doc-content",
  ".content-main",
  "#content",
  "#main-content",
  ".content",
  "body",
];

/**
 * Extracts clean, structured content blocks from a documentation page HTML.
 */
export function extractPageContent(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  // 1. Extract Page Title
  let title = $("h1").first().text().trim();
  if (!title) {
    title = $("title").first().text().trim();
  }
  if (!title) {
    try {
      const parsed = new URL(pageUrl);
      title = parsed.pathname.split("/").filter(Boolean).pop() || "Document Page";
    } catch {
      title = "Document Page";
    }
  }

  // Clean title suffix if present
  if (title.includes(" - ")) {
    title = title.split(" - ")[0].trim();
  } else if (title.includes(" | ")) {
    title = title.split(" | ")[0].trim();
  }

  // 2. Remove boilerplate elements
  $(STRIP_SELECTORS.join(", ")).remove();

  // 3. Find primary content container
  let $container: ReturnType<CheerioRoot> | null = null;
  for (const selector of MAIN_CONTAINER_SELECTORS) {
    const el = $(selector);
    if (el.length > 0 && el.text().trim().length > 50) {
      $container = el.first();
      break;
    }
  }

  if (!$container) {
    $container = $("body");
  }

  const blocks: ContentBlock[] = [];
  let totalWords = 0;

  function countWords(str: string): number {
    return str.trim().split(/\s+/).filter(Boolean).length;
  }

  // Process elements recursively or direct children
  // We query key content elements within the container
  $container.find("h1, h2, h3, h4, h5, h6, p, pre, ul, ol, blockquote, table, img, hr, .admonition, .callout, .alert").each((_, el) => {
    const $el = $(el);

    // Skip elements nested within pre, table, ul, ol, blockquote to prevent duplicates
    if ($el.parents("pre, table, ul, ol, blockquote, .admonition, .callout, .alert").length > 0) {
      return;
    }

    const tagName = el.tagName.toLowerCase();

    // Headings
    if (/^h[1-6]$/.test(tagName)) {
      const level = parseInt(tagName.charAt(1), 10);
      const text = $el.text().trim();
      if (text) {
        blocks.push({ type: "heading", level, text });
        totalWords += countWords(text);
      }
      return;
    }

    // Code blocks
    if (tagName === "pre") {
      const $code = $el.find("code");
      const code = ($code.length > 0 ? $code.text() : $el.text()).replace(/\r\n/g, "\n");
      const classAttr = ($code.attr("class") || $el.attr("class") || "");
      const langMatch = classAttr.match(/language-([a-zA-Z0-9_-]+)/);
      const language = langMatch ? langMatch[1] : undefined;

      if (code.trim()) {
        blocks.push({ type: "code", code, language });
        totalWords += countWords(code);
      }
      return;
    }

    // Paragraphs
    if (tagName === "p") {
      const text = $el.text().trim().replace(/\s+/g, " ");
      if (text) {
        blocks.push({ type: "paragraph", text });
        totalWords += countWords(text);
      }
      return;
    }

    // Lists
    if (tagName === "ul" || tagName === "ol") {
      const ordered = tagName === "ol";
      const items: string[] = [];
      $el.children("li").each((_, li) => {
        const itemText = $(li).text().trim().replace(/\s+/g, " ");
        if (itemText) {
          items.push(itemText);
          totalWords += countWords(itemText);
        }
      });
      if (items.length > 0) {
        blocks.push({ type: "list", ordered, items });
      }
      return;
    }

    // Callouts & Blockquotes
    if (tagName === "blockquote" || $el.hasClass("admonition") || $el.hasClass("callout") || $el.hasClass("alert")) {
      const classList = ($el.attr("class") || "").toLowerCase();
      let variant: "note" | "tip" | "warning" | "caution" | "info" = "note";
      if (classList.includes("tip") || classList.includes("success")) {
        variant = "tip";
      } else if (classList.includes("warn") || classList.includes("warning")) {
        variant = "warning";
      } else if (classList.includes("danger") || classList.includes("caution") || classList.includes("error")) {
        variant = "caution";
      } else if (classList.includes("info")) {
        variant = "info";
      }

      const text = $el.text().trim().replace(/\s+/g, " ");
      if (text) {
        blocks.push({ type: "callout", variant, text });
        totalWords += countWords(text);
      }
      return;
    }

    // Tables
    if (tagName === "table") {
      const headers: string[] = [];
      const rows: string[][] = [];

      $el.find("thead tr th, thead tr td, tr:first-child th").each((_, th) => {
        headers.push($(th).text().trim().replace(/\s+/g, " "));
      });

      $el.find("tbody tr, tr").each((i, tr) => {
        // If first row was used as header, skip it
        if (headers.length > 0 && i === 0 && $(tr).find("th").length > 0) {
          return;
        }

        const row: string[] = [];
        $(tr).find("td, th").each((_, cell) => {
          row.push($(cell).text().trim().replace(/\s+/g, " "));
        });

        if (row.length > 0 && row.some(Boolean)) {
          rows.push(row);
          row.forEach((cell) => {
            totalWords += countWords(cell);
          });
        }
      });

      if (headers.length > 0 || rows.length > 0) {
        blocks.push({ type: "table", headers, rows });
      }
      return;
    }

    // Images
    if (tagName === "img") {
      const src = $el.attr("src");
      const alt = $el.attr("alt") || "";
      if (src && !src.startsWith("data:")) {
        try {
          const resolvedSrc = new URL(src, pageUrl).href;
          blocks.push({ type: "image", src: resolvedSrc, alt });
        } catch {
          // Ignore invalid image URLs
        }
      }
      return;
    }

    // Horizontal Rule
    if (tagName === "hr") {
      blocks.push({ type: "hr" });
      return;
    }
  });

  if (blocks.length === 0) {
    warnings.push(`Page '${title}' yielded minimal content.`);
  }

  return {
    url: pageUrl,
    title,
    blocks,
    wordCount: totalWords,
    warnings,
  };
}
