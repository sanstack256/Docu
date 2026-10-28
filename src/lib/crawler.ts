import * as cheerio from "cheerio";
import { safeFetch, validateUrlStructure } from "./security";

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

export interface ExtractedLink {
  url: string;
  title?: string;
  section?: string;
  isNav: boolean;
}

const IGNORED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".avif", ".bmp",
  ".pdf", ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
  ".exe", ".dmg", ".pkg", ".deb", ".rpm", ".msi", ".iso", ".bin",
  ".mp4", ".mp3", ".webm", ".avi", ".mov", ".wav", ".ogg",
  ".css", ".js", ".mjs", ".cjs", ".map", ".json", ".xml", ".rss", ".atom",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
]);

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "ref", "source", "fbclid", "gclid", "_ga", "_gl", "mc_cid", "mc_eid", "token",
]);

const NAV_CONTAINER_SELECTOR = [
  "nav",
  "aside",
  "[role='navigation']",
  ".sidebar",
  ".docs-sidebar",
  ".doc-sidebar",
  ".vp-sidebar",
  ".md-sidebar",
  ".toctree-wrapper",
  ".bd-sidebar",
  ".menu",
  ".nav-list",
  "#sidebar",
].join(", ");

/**
 * Normalizes a URL by stripping fragments, removing tracking query params,
 * sorting remaining query params deterministically, and standardizing paths.
 */
export function normalizeUrl(inputUrl: string): string {
  const parsed = new URL(inputUrl);

  // Strip hash fragment
  parsed.hash = "";

  // Filter out tracking query params
  const keysToDelete: string[] = [];
  parsed.searchParams.forEach((_, key) => {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower) || lower.startsWith("utm_")) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => parsed.searchParams.delete(key));

  // Sort remaining query parameters for deterministic deduplication
  parsed.searchParams.sort();

  // Normalize pathname: remove duplicate slashes, keep trailing slash consistent
  let path = parsed.pathname.replace(/\/+/g, "/");
  if (path !== "/" && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  parsed.pathname = path;

  return parsed.href;
}

/**
 * Produces a canonical deduplication key so URLs like `/docs/index.html` and `/docs`
 * are recognized as the same documentation page.
 */
export function getCanonicalDedupKey(inputUrl: string): string {
  try {
    const norm = normalizeUrl(inputUrl);
    const parsed = new URL(norm);
    parsed.pathname = parsed.pathname.replace(/\/index\.html?$/i, "") || "/";
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return inputUrl;
  }
}

/**
 * Cleans a raw page or link title by removing permalink markers and site suffixes.
 */
export function cleanPageTitle(rawTitle: string): string {
  let cleaned = rawTitle
    .replace(/[¶#]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.includes(" — ")) {
    cleaned = cleaned.split(" — ")[0].trim();
  } else if (cleaned.includes(" - ")) {
    cleaned = cleaned.split(" - ")[0].trim();
  } else if (cleaned.includes(" | ")) {
    cleaned = cleaned.split(" | ")[0].trim();
  } else if (cleaned.includes(" · ")) {
    cleaned = cleaned.split(" · ")[0].trim();
  }

  return cleaned;
}

/**
 * Infers a human-readable fallback title from a URL path.
 */
export function inferTitleFromUrl(pageUrl: string): string {
  try {
    const parsed = new URL(pageUrl);
    const segments = parsed.pathname
      .replace(/\/index\.html?$/i, "")
      .split("/")
      .filter(Boolean);
    if (segments.length === 0) return "Overview";
    const last = segments[segments.length - 1]
      .replace(/\.html?$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (!last) return "Overview";
    return last.charAt(0).toUpperCase() + last.slice(1);
  } catch {
    return "Documentation Page";
  }
}

/**
 * Infers a section name from the URL path relative to the documentation root.
 */
export function inferSectionFromPath(pageUrl: string, rootUrl: string): string | undefined {
  try {
    const candidate = new URL(pageUrl);
    const root = new URL(rootUrl);
    let basePath = root.pathname.replace(/\/index\.html?$/i, "");
    if (basePath.endsWith("/") && basePath.length > 1) {
      basePath = basePath.slice(0, -1);
    }
    if (/\.[a-zA-Z0-9]+$/.test(basePath)) {
      basePath = basePath.substring(0, basePath.lastIndexOf("/"));
    }

    const rel = candidate.pathname.startsWith(basePath)
      ? candidate.pathname.slice(basePath.length)
      : candidate.pathname;

    const segments = rel.replace(/\/index\.html?$/i, "").split("/").filter(Boolean);
    if (segments.length >= 2) {
      const folder = segments[0].replace(/[-_]+/g, " ").trim();
      return folder.charAt(0).toUpperCase() + folder.slice(1);
    }
    return undefined;
  } catch {
    return undefined;
  }
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
 * Extracts links and page metadata from HTML content, prioritizing navigation links.
 */
export function extractLinksAndTitle(
  html: string,
  pageUrl: string
): { title: string; links: string[]; detailedLinks: ExtractedLink[] } {
  const $ = cheerio.load(html);

  // Remove script/style/permalink noise before reading titles
  $("script, style, noscript, .headerlink, .anchor-link, .hash-link").remove();

  // Extract page title
  let rawTitle = $("h1").first().text().trim();
  if (!rawTitle) {
    rawTitle = $("title").first().text().trim();
  }
  const title = cleanPageTitle(rawTitle) || inferTitleFromUrl(pageUrl);

  const detailedLinks: ExtractedLink[] = [];
  const seenInPage = new Set<string>();

  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href")?.trim();
    if (!href) return;

    // Ignore anchors, javascript, mailto, tel, data
    if (
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("data:")
    ) {
      return;
    }

    try {
      const resolved = new URL(href, pageUrl).href;
      const normalized = normalizeUrl(resolved);
      const linkText = cleanPageTitle($el.text());
      const isNav = $el.closest(NAV_CONTAINER_SELECTOR).length > 0;

      // Try to find a navigation group heading if inside nav
      let section: string | undefined;
      if (isNav) {
        const navGroupTitle = $el
          .closest("li, .nav-group, .sidebar-group, .menu-group, section")
          .parent()
          .prev("h2, h3, h4, .nav-title, .sidebar-heading, .caption, p.caption")
          .text()
          .trim();
        if (navGroupTitle && navGroupTitle.length < 60) {
          section = cleanPageTitle(navGroupTitle);
        }
      }

      if (!seenInPage.has(normalized)) {
        seenInPage.add(normalized);
        detailedLinks.push({
          url: normalized,
          title: linkText && linkText.length >= 2 && linkText.length <= 120 ? linkText : undefined,
          section,
          isNav,
        });
      } else if (linkText && isNav) {
        // Upgrade existing entry if a navigation link provides a better title
        const existing = detailedLinks.find((d) => d.url === normalized);
        if (existing && (!existing.title || !existing.isNav)) {
          existing.title = linkText;
          existing.isNav = true;
          if (section) existing.section = section;
        }
      }
    } catch {
      // Ignore invalid URLs
    }
  });

  // Order navigation links before general body links to preserve documentation structure
  detailedLinks.sort((a, b) => (a.isNav === b.isNav ? 0 : a.isNav ? -1 : 1));

  return {
    title,
    links: detailedLinks.map((d) => d.url),
    detailedLinks,
  };
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
  let rootUrl = normalizeUrl(validated.href);
  const warnings: string[] = [];

  const visitedDedupKeys = new Set<string>();
  const discoveredMap = new Map<string, DiscoveredPage>();

  // Fetch root page first
  let rootHtml = "";
  let siteTitle = validated.hostname;

  try {
    const rootRes = await safeFetch(rootUrl, { timeoutMs });
    if (rootRes.status >= 400) {
      throw new Error(`Target returned HTTP ${rootRes.status}`);
    }
    // Update rootUrl if redirected to a canonical documentation path
    if (rootRes.url) {
      rootUrl = normalizeUrl(rootRes.url);
    }
    rootHtml = await rootRes.text();
    const rootData = extractLinksAndTitle(rootHtml, rootUrl);
    siteTitle = rootData.title || validated.hostname;

    const rootKey = getCanonicalDedupKey(rootUrl);
    visitedDedupKeys.add(rootKey);
    discoveredMap.set(rootKey, {
      url: rootUrl,
      title: rootData.title || "Overview",
      path: new URL(rootUrl).pathname,
      section: "Overview",
      depth: 0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to access starting documentation URL: ${msg}`);
  }

  // First extract links from the root page (especially navigation/sidebar links which have rich titles)
  const rootExtracted = extractLinksAndTitle(rootHtml, rootUrl);
  const queue: Array<{ url: string; depth: number; html?: string }> = [];

  for (const item of rootExtracted.detailedLinks) {
    if (discoveredMap.size >= maxPages) break;
    if (!isWithinDocScope(item.url, rootUrl)) continue;

    const dedupKey = getCanonicalDedupKey(item.url);
    if (!visitedDedupKeys.has(dedupKey)) {
      visitedDedupKeys.add(dedupKey);
      const parsed = new URL(item.url);
      discoveredMap.set(dedupKey, {
        url: item.url,
        title: item.title || inferTitleFromUrl(item.url),
        path: parsed.pathname,
        section: item.section || inferSectionFromPath(item.url, rootUrl),
        depth: 1,
      });
      queue.push({ url: item.url, depth: 1 });
    }
  }

  // Attempt to check sitemap.xml if we still have room for more pages
  if (discoveredMap.size < maxPages) {
    try {
      const sitemapUrl = new URL("/sitemap.xml", rootUrl).href;
      const sitemapRes = await safeFetch(sitemapUrl, { timeoutMs: 5000, retries: 0 });
      if (sitemapRes.status === 200) {
        const sitemapXml = await sitemapRes.text();
        const $xml = cheerio.load(sitemapXml, { xmlMode: true });
        $xml("url > loc, loc").each((_, locEl) => {
          if (discoveredMap.size >= maxPages) return false;
          const locUrl = $xml(locEl).text().trim();
          if (locUrl && !locUrl.endsWith(".xml") && isWithinDocScope(locUrl, rootUrl)) {
            const norm = normalizeUrl(locUrl);
            const dedupKey = getCanonicalDedupKey(norm);
            if (!visitedDedupKeys.has(dedupKey)) {
              visitedDedupKeys.add(dedupKey);
              const locPath = new URL(norm).pathname;
              discoveredMap.set(dedupKey, {
                url: norm,
                title: inferTitleFromUrl(norm),
                path: locPath,
                section: inferSectionFromPath(norm, rootUrl),
                depth: 1,
              });
            }
          }
        });
      }
    } catch {
      // Sitemap discovery failure is non-fatal; proceed with DOM link crawling
    }
  }

  // Breadth-first link crawling if more pages can be discovered
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
          warnings.push(`Page returned HTTP ${res.status}: ${current.url}`);
          continue;
        }
      } catch (err: unknown) {
        warnings.push(
          `Could not fetch linked page ${current.url}: ${err instanceof Error ? err.message : String(err)}`
        );
        continue;
      }
    }

    const { title: fetchedTitle, detailedLinks } = extractLinksAndTitle(html, current.url);
    const currentKey = getCanonicalDedupKey(current.url);
    const currentEntry = discoveredMap.get(currentKey);
    if (currentEntry && fetchedTitle && currentEntry.title === inferTitleFromUrl(current.url)) {
      currentEntry.title = fetchedTitle;
    }

    for (const item of detailedLinks) {
      if (discoveredMap.size >= maxPages) break;
      if (!isWithinDocScope(item.url, rootUrl)) continue;

      const dedupKey = getCanonicalDedupKey(item.url);
      if (!visitedDedupKeys.has(dedupKey)) {
        visitedDedupKeys.add(dedupKey);
        try {
          const parsed = new URL(item.url);
          discoveredMap.set(dedupKey, {
            url: item.url,
            title: item.title || inferTitleFromUrl(item.url),
            path: parsed.pathname,
            section: item.section || inferSectionFromPath(item.url, rootUrl),
            depth: current.depth + 1,
          });
          queue.push({ url: item.url, depth: current.depth + 1 });
        } catch {
          // Ignore malformed URLs
        }
      } else {
        // Upgrade title if existing entry only had a slug-inferred title
        const existing = discoveredMap.get(dedupKey);
        if (existing && item.title && existing.title === inferTitleFromUrl(existing.url)) {
          existing.title = item.title;
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
