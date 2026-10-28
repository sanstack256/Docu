import * as cheerio from "cheerio";
import { safeFetch } from "./security";

type CheerioRoot = ReturnType<typeof cheerio.load>;

export interface InlineLink {
  text: string;
  href: string;
}

export type ContentBlock =
  | { type: "heading"; level: number; text: string; id?: string }
  | { type: "paragraph"; text: string; links?: InlineLink[] }
  | { type: "code"; code: string; language?: string }
  | { type: "list"; ordered: boolean; items: string[]; indent?: number }
  | { type: "callout"; variant: "note" | "tip" | "warning" | "caution" | "info"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "image"; src: string; alt?: string; caption?: string; data?: Buffer }
  | { type: "hr" };

export interface ExtractedPage {
  url: string;
  title: string;
  blocks: ContentBlock[];
  wordCount: number;
  warnings: string[];
  isExcerpt?: boolean;
}

const STRIP_SELECTORS = [
  "script", "style", "noscript", "iframe", "svg",
  "nav", "header", "footer", "aside",
  ".sidebar", ".navigation", ".menu", ".nav", ".site-nav", ".sub-nav",
  ".cookie-banner", ".cookie-notice", ".cookie-consent", ".gdpr",
  ".advertisement", ".ad", ".banner", ".sponsored", ".sponsor",
  ".ad-container", ".ad-wrapper", ".advert", ".google-ad", ".adsbygoogle",
  ".social-share", ".share-buttons", ".share-bar", ".share-links", ".social-links",
  ".toc", ".table-of-contents", ".page-toc", ".toctree-wrapper",
  ".headerlink", ".anchor", ".hash-link", ".heading-anchor",
  ".linenos", ".line-numbers-rows", ".copybtn", ".copy-code-button",
  ".edit-page", ".page-nav", ".pagination-nav", ".prev-next", ".breadcrumbs",
  ".comments", "#comments", ".comment-list", ".disqus", ".fb-comments",
  ".related-posts", ".related-articles", ".recommended-articles", ".more-from",
  ".author-bio", ".author-box", ".author-profile", ".about-author",
  ".newsletter", ".subscribe", ".newsletter-signup", ".signup-box",
  "button", "form", "input", "select", "textarea",
];

const CANDIDATE_CONTAINER_SELECTORS = [
  "main",
  "article",
  "[role='main']",
  ".entry-content",
  ".post-content",
  ".article-content",
  ".article-body",
  ".article__body",
  ".story-body",
  ".instapaper_body",
  ".prose",
  ".markdown-body",
  ".theme-doc-markdown",
  ".vp-doc",
  ".nextra-content",
  ".sl-markdown-content",
  ".md-content__inner",
  ".rst-content",
  ".document",
  ".documentation-content",
  ".documentation",
  ".docs-content",
  ".doc-content",
  ".content-main",
  "#content",
  "#main-content",
  ".content",
];

function cleanHeadingOrTitleText(raw: string): string {
  return raw
    .replace(/[¶#]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractInlineLinks($: CheerioRoot, $el: ReturnType<CheerioRoot>, pageUrl: string): InlineLink[] {
  const links: InlineLink[] = [];
  $el.find("a[href]").each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href")?.trim();
    const text = $a.text().trim().replace(/\s+/g, " ");
    if (!href || !text || href.startsWith("javascript:") || href.startsWith("#")) return;
    try {
      const resolved = new URL(href, pageUrl).href;
      if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
        links.push({ text, href: resolved });
      }
    } catch {
      // Ignore malformed href
    }
  });
  return links;
}

/**
 * Evaluates candidate content containers using Readability-style heuristics:
 * considers paragraph density, text length, and link density to avoid picking navigation or card grids.
 */
function selectBestContentContainer($: CheerioRoot): ReturnType<CheerioRoot> {
  let bestElement: ReturnType<CheerioRoot> | null = null;
  let bestScore = -1;

  for (const selector of CANDIDATE_CONTAINER_SELECTORS) {
    const matched = $(selector);
    matched.each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      if (text.length < 50) return;

      // Link density: ratio of anchor text characters to total text characters
      let linkChars = 0;
      $el.find("a").each((_, a) => {
        linkChars += $(a).text().trim().length;
      });
      const linkDensity = text.length > 0 ? linkChars / text.length : 0;

      // High link density indicates navigation or directory list, not an article/content container
      if (linkDensity > 0.55 && text.length < 1000) return;

      // Paragraph count
      const pElements = $el.find("p");
      let substantialPCount = 0;
      pElements.each((_, p) => {
        if ($(p).text().trim().length > 25) substantialPCount++;
      });

      // Heading count
      const hCount = $el.find("h1, h2, h3, h4, h5, h6").length;
      const preCount = $el.find("pre").length;
      const tableCount = $el.find("table").length;

      // Class / ID heuristics
      const classIdStr = (($el.attr("class") || "") + " " + ($el.attr("id") || "")).toLowerCase();
      let bonus = 0;
      if (/article|post|body|entry|content|story|main|docs/.test(classIdStr)) bonus += 25;
      if (/sidebar|nav|menu|widget|comment|footer|header|promo|related/.test(classIdStr)) bonus -= 50;

      // Semantic tag bonus
      const tagName = "tagName" in el ? (el as { tagName: string }).tagName.toLowerCase() : "";
      if (tagName === "article") bonus += 40;
      if (tagName === "main") bonus += 35;

      const score =
        substantialPCount * 25 +
        preCount * 20 +
        tableCount * 15 +
        hCount * 10 +
        Math.min(text.length / 50, 80) +
        bonus -
        linkDensity * 120;

      if (score > bestScore) {
        bestScore = score;
        bestElement = $el;
      }
    });
  }

  if (bestElement && bestScore > 15) {
    return bestElement;
  }

  const $body = $("body");
  return $body.length > 0 ? $body : ($.root() as unknown as ReturnType<CheerioRoot>);
}

/**
 * Extracts clean, structured content blocks from a documentation, article, or informational webpage HTML.
 */
export function extractPageContent(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  // Remove permalink noise first so titles/headings are clean
  $(".headerlink, .anchor, .hash-link, .heading-anchor").remove();

  // 1. Extract Page Title
  let title = cleanHeadingOrTitleText($("h1").first().text());
  if (!title) {
    title = cleanHeadingOrTitleText($("meta[property='og:title']").attr("content") || "");
  }
  if (!title) {
    title = cleanHeadingOrTitleText($("title").first().text());
  }
  if (!title) {
    try {
      const parsed = new URL(pageUrl);
      title = parsed.pathname.split("/").filter(Boolean).pop() || "Document Page";
    } catch {
      title = "Document Page";
    }
  }

  // Clean title branding suffix if present (e.g., "Doc Title — Brand", "Doc Title | Brand")
  if (title.includes(" — ")) {
    title = title.split(" — ")[0].trim();
  } else if (title.includes(" - ")) {
    title = title.split(" - ")[0].trim();
  } else if (title.includes(" | ")) {
    title = title.split(" | ")[0].trim();
  }

  // 2. Remove boilerplate elements
  $(STRIP_SELECTORS.join(", ")).remove();

  // 3. Find primary content container using heuristics
  const $container = selectBestContentContainer($);

  const blocks: ContentBlock[] = [];
  let totalWords = 0;

  function countWords(str: string): number {
    return str.trim().split(/\s+/).filter(Boolean).length;
  }

  const BLOCK_QUERY = [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "pre", "ul", "ol", "dl",
    "blockquote", "table", "figure", "img", "hr",
    ".admonition", ".callout", ".alert",
  ].join(", ");

  $container.find(BLOCK_QUERY).each((_, el) => {
    const $el = $(el);
    const tagName = el.tagName.toLowerCase();

    // Avoid double extraction if element is inside an already handled composite block
    if (tagName === "pre") {
      if ($el.parents("pre, table, blockquote, .admonition, .callout, .alert").length > 0) {
        return;
      }
    } else if (tagName === "ul" || tagName === "ol") {
      if ($el.parents("pre, table, blockquote, .admonition, .callout, .alert").length > 0) {
        return;
      }
    } else if (tagName === "img") {
      // If img is inside a figure, let figure handle it with caption
      if ($el.parents("figure").length > 0) {
        return;
      }
      if ($el.parents("pre, table, blockquote, .admonition, .callout, .alert").length > 0) {
        return;
      }
    } else {
      if ($el.parents("figure, pre, table, ul, ol, dl, blockquote, .admonition, .callout, .alert").length > 0) {
        return;
      }
    }

    // Headings
    if (/^h[1-6]$/.test(tagName)) {
      const level = parseInt(tagName.charAt(1), 10);
      const text = cleanHeadingOrTitleText($el.text());
      const id = $el.attr("id") || undefined;
      if (text) {
        blocks.push({ type: "heading", level, text, id });
        totalWords += countWords(text);
      }
      return;
    }

    // Code blocks
    if (tagName === "pre") {
      const $code = $el.find("code");
      const rawCode = ($code.length > 0 ? $code.text() : $el.text())
        .replace(/\r\n/g, "\n")
        .replace(/\t/g, "  ")
        .replace(/^\n+|\n+$/g, "");
      const classAttr = ($code.attr("class") || $el.attr("class") || $el.parent().attr("class") || "");
      const langMatch = classAttr.match(/(?:language-|lang-|highlight-)([a-zA-Z0-9_+-]+)/);
      const language = langMatch ? langMatch[1] : undefined;

      if (rawCode.trim()) {
        blocks.push({ type: "code", code: rawCode, language });
        totalWords += countWords(rawCode);
      }
      return;
    }

    // Paragraphs
    if (tagName === "p") {
      const text = $el.text().trim().replace(/\s+/g, " ");
      if (text) {
        const links = extractInlineLinks($, $el, pageUrl);
        blocks.push({
          type: "paragraph",
          text,
          ...(links.length > 0 ? { links } : {}),
        });
        totalWords += countWords(text);
      }
      return;
    }

    // Ordered & Unordered Lists
    if (tagName === "ul" || tagName === "ol") {
      const ordered = tagName === "ol";
      const indent = $el.parents("ul, ol").length;
      const items: string[] = [];

      $el.children("li").each((_, li) => {
        const $li = $(li).clone();
        $li.find("ul, ol, pre").remove();
        const itemText = $li.text().trim().replace(/\s+/g, " ");
        if (itemText) {
          items.push(itemText);
          totalWords += countWords(itemText);
        }
      });

      if (items.length > 0) {
        blocks.push({
          type: "list",
          ordered,
          items,
          ...(indent > 0 ? { indent } : {}),
        });
      }
      return;
    }

    // Definition Lists (<dl>, <dt>, <dd>)
    if (tagName === "dl") {
      $el.children("dt, dd").each((_, child) => {
        const $child = $(child);
        const childTag = child.tagName.toLowerCase();
        const text = $child.text().trim().replace(/\s+/g, " ");
        if (!text) return;

        if (childTag === "dt") {
          blocks.push({ type: "heading", level: 4, text });
          totalWords += countWords(text);
        } else {
          blocks.push({ type: "paragraph", text });
          totalWords += countWords(text);
        }
      });
      return;
    }

    // Callouts & Blockquotes
    if (tagName === "blockquote" || $el.hasClass("admonition") || $el.hasClass("callout") || $el.hasClass("alert")) {
      const classList = ($el.attr("class") || "").toLowerCase();
      let variant: "note" | "tip" | "warning" | "caution" | "info" = "note";
      if (classList.includes("tip") || classList.includes("success") || classList.includes("hint")) {
        variant = "tip";
      } else if (classList.includes("warn") || classList.includes("warning") || classList.includes("attention")) {
        variant = "warning";
      } else if (
        classList.includes("danger") ||
        classList.includes("caution") ||
        classList.includes("error") ||
        classList.includes("important")
      ) {
        variant = "caution";
      } else if (classList.includes("info") || classList.includes("seealso")) {
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
        if (headers.length > 0 && i === 0 && $(tr).find("th").length > 0 && $(tr).parents("tbody").length === 0) {
          return;
        }

        const row: string[] = [];
        $(tr).find("td, th").each((_, cell) => {
          row.push($(cell).text().trim().replace(/\s+/g, " "));
        });

        if (
          headers.length > 0 &&
          row.length === headers.length &&
          row.every((val, idx) => val === headers[idx])
        ) {
          return;
        }

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

    // Figures with Captions
    if (tagName === "figure") {
      const $img = $el.find("img").first();
      const src = $img.attr("src")?.trim();
      const alt = ($img.attr("alt") || $img.attr("title") || "").trim();
      const caption = $el.find("figcaption").text().trim().replace(/\s+/g, " ") || undefined;

      if (src && !src.startsWith("data:")) {
        try {
          const resolvedSrc = new URL(src, pageUrl).href;
          if (resolvedSrc.startsWith("http://") || resolvedSrc.startsWith("https://")) {
            blocks.push({
              type: "image",
              src: resolvedSrc,
              alt: alt || undefined,
              caption: caption || undefined,
            });
            if (caption) totalWords += countWords(caption);
          }
        } catch {
          warnings.push(`Skipped malformed image URL on ${pageUrl}`);
        }
      }
      return;
    }

    // Standalone Images
    if (tagName === "img") {
      const src = $el.attr("src")?.trim();
      const alt = ($el.attr("alt") || $el.attr("title") || "").trim();
      if (src && !src.startsWith("data:")) {
        try {
          const resolvedSrc = new URL(src, pageUrl).href;
          if (resolvedSrc.startsWith("http://") || resolvedSrc.startsWith("https://")) {
            blocks.push({ type: "image", src: resolvedSrc, alt: alt || undefined });
          }
        } catch {
          warnings.push(`Skipped malformed image URL on ${pageUrl}`);
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

  // Excerpt & Stub Detection
  let isExcerpt = false;
  const rawText = blocks
    .map((b) => ("text" in b ? b.text : "code" in b ? b.code : ""))
    .join(" ");

  const hasTeaserPhrase =
    /read\s+(?:the\s+)?full\s+(?:story|article)|continue\s+reading|subscribe\s+to\s+(?:read|continue)|full\s+article\s+available\s+to\s+subscribers/i.test(
      rawText
    );

  if (hasTeaserPhrase || (totalWords > 0 && totalWords < 55 && rawText.endsWith("..."))) {
    isExcerpt = true;
    warnings.push("Page appears to be an excerpt or summary rather than the complete article.");
  }

  // Reliability Assessment
  if (blocks.length === 0 || (blocks.length === 1 && totalWords < 15)) {
    warnings.push(`Main content could not be reliably identified for page '${title}'.`);
  }

  return {
    url: pageUrl,
    title,
    blocks,
    wordCount: totalWords,
    warnings,
    ...(isExcerpt ? { isExcerpt: true } : {}),
  };
}

/**
 * Safely fetches supported raster images (PNG/JPEG) referenced in an ExtractedPage
 * so they can be embedded proportionally into the PDF. Records warnings for
 * inaccessible or unsupported image formats (such as SVG/WebP).
 */
export async function enrichPageImages(
  page: ExtractedPage,
  maxImagesPerPage = 5
): Promise<ExtractedPage> {
  let fetchedCount = 0;

  for (const block of page.blocks) {
    if (block.type !== "image") continue;
    if (fetchedCount >= maxImagesPerPage) {
      page.warnings.push(`Image limit (${maxImagesPerPage}) reached on ${page.title}; remaining images linked.`);
      break;
    }

    const lowerUrl = block.src.toLowerCase().split("?")[0];
    if (lowerUrl.endsWith(".svg") || lowerUrl.endsWith(".webp") || lowerUrl.endsWith(".gif")) {
      page.warnings.push(`Non-embedded image format (${lowerUrl.split(".").pop()}) linked as reference: ${block.src}`);
      continue;
    }

    try {
      const res = await safeFetch(block.src, {
        timeoutMs: 5000,
        maxSizeBytes: 2 * 1024 * 1024, // 2 MB max per image
        retries: 0,
        headers: {
          Accept: "image/png,image/jpeg,image/jpg;q=0.9,*/*;q=0.5",
        },
      });

      if (res.status !== 200) {
        page.warnings.push(`Image returned HTTP ${res.status}: ${block.src}`);
        continue;
      }

      const buf = await res.buffer();
      // Check PNG (89 50 4E 47) or JPEG (FF D8 FF) magic bytes
      const isPng =
        buf.length > 8 &&
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47;
      const isJpeg =
        buf.length > 3 &&
        buf[0] === 0xff &&
        buf[1] === 0xd8 &&
        buf[2] === 0xff;

      if (isPng || isJpeg) {
        block.data = buf;
        fetchedCount++;
      } else {
        page.warnings.push(`Unsupported image encoding linked as reference: ${block.src}`);
      }
    } catch {
      page.warnings.push(`Could not retrieve image resource: ${block.src}`);
    }
  }

  return page;
}
