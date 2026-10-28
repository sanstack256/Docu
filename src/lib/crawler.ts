import * as cheerio from "cheerio";
import { safeFetch, validateUrlStructure, SecurityError } from "./security";

export interface DiscoveredPage {
  url: string;
  title: string;
  path: string;
  section?: string;
  depth: number;
}

export interface DiscoveryOptions {
  maxPages?: number;
  maxDepth?: number;
  timeoutMs?: number;
}

export interface DiscoveryResult {
  rootUrl: string;
  siteTitle: string;
  pages: DiscoveredPage[];
  warnings: string[];
}

const IGNORED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar",
  ".exe", ".dmg", ".pkg", ".deb", ".rpm",
  ".mp4", ".mp3", ".webm", ".avi", ".mov",
  ".css", ".js", ".mjs", ".json", ".xml", ".rss", ".atom",
]);

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "ref", "source", "fbclid", "gclid", "_ga", "token",
]);

/**
 * Normalizes a URL by stripping fragments, removing tracking query params,
 * and standardizing paths.
 */
export function normalizeUrl(inputUrl: string): string {
  const parsed = new URL(inputUrl);

  // Strip hash fragment
  parsed.hash = "";

  // Filter out tracking query params
  const keysToDelete: string[] = [];
  parsed.searchParams.forEach((_, key) => {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || key.startsWith("utm_")) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => parsed.searchParams.delete(key));

  // Normalize pathname: remove duplicate slashes, keep trailing slash consistent
  let path = parsed.pathname.replace(/\/+/g, "/");
  if (path !== "/" && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  parsed.pathname = path;

  return parsed.href;
}

/**
 * Checks whether a candidate URL is within the documentation scope of the base URL.
 */
export function isWithinDocScope(candidateUrl: string, rootUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const root = new URL(rootUrl);

    // Must match origin (protocol and host)
    if (candidate.origin !== root.origin) {
      return false;
    }

    // Must not be an ignored file extension
    const extMatch = candidate.pathname.match(/\.[a-zA-Z0-9]+$/);
    if (extMatch && IGNORED_EXTENSIONS.has(extMatch[0].toLowerCase())) {
      return false;
    }

    // Determine the base documentation path
    let basePath = root.pathname;
    if (basePath.endsWith("/") && basePath.length > 1) {
      basePath = basePath.slice(0, -1);
    }
    // If root path is a specific file like /index.html or /docs/intro.html, strip filename
    if (/\.[a-zA-Z0-9]+$/.test(basePath)) {
      basePath = basePath.substring(0, basePath.lastIndexOf("/"));
    }

    // Root scope check
    if (basePath === "" || basePath === "/") {
      return true;
    }

    return candidate.pathname === basePath || candidate.pathname.startsWith(basePath + "/");
  } catch {
    return false;
  }
}

/**
 * Extracts links and page metadata from HTML content.
 */
export function extractLinksAndTitle(
  html: string,
  pageUrl: string
): { title: string; links: string[] } {
  const $ = cheerio.load(html);

  // Extract page title
  let title = $("title").first().text().trim();
  if (!title) {
    title = $("h1").first().text().trim();
  }
  if (!title) {
    try {
      const parsed = new URL(pageUrl);
      title = parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
    } catch {
      title = "Untitled Page";
    }
  }

  // Clean title (often documentation titles are "Page Title | Project Name")
  if (title.includes(" - ")) {
    title = title.split(" - ")[0].trim();
  } else if (title.includes(" | ")) {
    title = title.split(" | ")[0].trim();
  }

  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // Ignore anchors, javascript, mailto, etc.
    if (href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return;
    }

    try {
      const resolved = new URL(href, pageUrl).href;
      links.push(normalizeUrl(resolved));
    } catch {
      // Ignore invalid URLs
    }
  });

  return { title, links };
}

/**
 * Discovers pages in a documentation site using deterministic sitemap and link crawling.
 */
export async function discoverPages(
  targetUrl: string,
  options: DiscoveryOptions = {}
): Promise<DiscoveryResult> {
  const { maxPages = 20, maxDepth = 3, timeoutMs = 10000 } = options;

  const validated = validateUrlStructure(targetUrl);
  const rootUrl = normalizeUrl(validated.href);
  const warnings: string[] = [];

  const visitedUrls = new Set<string>();
  const discoveredMap = new Map<string, DiscoveredPage>();

  // Fetch root page first
  let rootHtml = "";
  let siteTitle = validated.hostname;

  try {
    const rootRes = await safeFetch(rootUrl, { timeoutMs });
    if (rootRes.status >= 400) {
      throw new Error(`Target returned HTTP ${rootRes.status}`);
    }
    rootHtml = await rootRes.text();
    const rootData = extractLinksAndTitle(rootHtml, rootUrl);
    siteTitle = rootData.title || validated.hostname;

    discoveredMap.set(rootUrl, {
      url: rootUrl,
      title: rootData.title || "Overview",
      path: validated.pathname,
      depth: 0,
    });
    visitedUrls.add(rootUrl);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to access starting documentation URL: ${msg}`);
  }

  // Attempt to check sitemap.xml
  try {
    const sitemapUrl = new URL("/sitemap.xml", rootUrl).href;
    const sitemapRes = await safeFetch(sitemapUrl, { timeoutMs: 5000 });
    if (sitemapRes.status === 200) {
      const sitemapXml = await sitemapRes.text();
      const $xml = cheerio.load(sitemapXml, { xmlMode: true });
      $xml("loc").each((_, locEl) => {
        if (discoveredMap.size >= maxPages) return false;
        const locUrl = $xml(locEl).text().trim();
        if (locUrl && isWithinDocScope(locUrl, rootUrl)) {
          const norm = normalizeUrl(locUrl);
          if (!discoveredMap.has(norm)) {
            const locPath = new URL(norm).pathname;
            const segments = locPath.split("/").filter(Boolean);
            const inferredTitle = segments.length > 0
              ? segments[segments.length - 1].replace(/[-_]/g, " ").replace(/\.html?$/i, "")
              : "Overview";

            discoveredMap.set(norm, {
              url: norm,
              title: inferredTitle.charAt(0).toUpperCase() + inferredTitle.slice(1),
              path: locPath,
              depth: 1,
            });
          }
        }
      });
    }
  } catch {
    // Sitemap discovery failure is non-fatal; proceed with DOM link crawling
  }

  // If sitemap didn't fill pages up to limit, perform breadth-first link crawling
  const queue: Array<{ url: string; depth: number; html?: string }> = [
    { url: rootUrl, depth: 0, html: rootHtml },
  ];

  while (queue.length > 0 && discoveredMap.size < maxPages) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    let html = current.html;
    if (!html) {
      try {
        const res = await safeFetch(current.url, { timeoutMs });
        if (res.status === 200) {
          html = await res.text();
        } else {
          warnings.push(`Page returned status ${res.status}: ${current.url}`);
          continue;
        }
      } catch (err: unknown) {
        warnings.push(`Could not fetch linked page ${current.url}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }

    const { links } = extractLinksAndTitle(html, current.url);

    for (const link of links) {
      if (discoveredMap.size >= maxPages) break;

      if (isWithinDocScope(link, rootUrl) && !visitedUrls.has(link)) {
        visitedUrls.add(link);

        try {
          const parsed = new URL(link);
          const segments = parsed.pathname.split("/").filter(Boolean);
          const inferredTitle = segments.length > 0
            ? segments[segments.length - 1].replace(/[-_]/g, " ").replace(/\.html?$/i, "")
            : "Page";

          discoveredMap.set(link, {
            url: link,
            title: inferredTitle.charAt(0).toUpperCase() + inferredTitle.slice(1),
            path: parsed.pathname,
            depth: current.depth + 1,
          });

          queue.push({ url: link, depth: current.depth + 1 });
        } catch {
          // Ignore
        }
      }
    }
  }

  const pages = Array.from(discoveredMap.values());

  return {
    rootUrl,
    siteTitle,
    pages,
    warnings,
  };
}
