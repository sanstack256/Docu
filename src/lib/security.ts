import dns from "node:dns";
import net from "node:net";

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * Checks whether an IPv4 address is in a reserved/private/internal range.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed is unsafe
  }

  const [a, b] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;

  // 10.0.0.0/8 (Private)
  if (a === 10) return true;

  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 169.254.0.0/16 (Link-local & Cloud Metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 (Private)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol)
  if (a === 192 && b === 0 && parts[2] === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && parts[2] === 2) return true;

  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15 (Benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && parts[2] === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4 (Reserved / Future use)
  if (a >= 240) return true;

  // 255.255.255.255 (Broadcast)
  if (parts.every((p) => p === 255)) return true;

  return false;
}

/**
 * Checks whether an IPv6 address is in a reserved/private/internal range.
 */
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Loopback (::1) or Unspecified (::)
  if (normalized === "::1" || normalized === "::") return true;

  // IPv4-mapped IPv6 (::ffff:192.168.1.1 or ::ffff:c0a8:0101)
  if (normalized.startsWith("::ffff:")) {
    const v4Part = normalized.replace("::ffff:", "");
    if (net.isIPv4(v4Part)) {
      return isPrivateIPv4(v4Part);
    }
  }

  // Unique local addresses (fc00::/7 -> fc00 to fdff)
  if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) return true;

  // Link-local unicast (fe80::/10 -> fe80 to febf)
  if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true;

  // Multicast (ff00::/8)
  if (normalized.startsWith("ff")) return true;

  return false;
}

/**
 * Validates that an IP address is public and safe to connect to.
 */
export function isSafeIP(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    return !isPrivateIPv4(ip);
  }
  if (version === 6) {
    return !isPrivateIPv6(ip);
  }
  return false;
}

/**
 * Validates a target URL structure, protocol, and hostname.
 */
export function validateUrlStructure(inputUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new SecurityError("Invalid URL format.");
  }

  // Only HTTP and HTTPS
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SecurityError(`Unsupported URL protocol: ${parsed.protocol}. Only http: and https: are allowed.`);
  }

  // Reject empty or local hostnames
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw new SecurityError("URL is missing a valid hostname.");
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname === "0.0.0.0"
  ) {
    throw new SecurityError(`Access to internal hostname '${hostname}' is prohibited.`);
  }

  // Check if hostname is an IP directly
  if (net.isIP(hostname)) {
    if (!isSafeIP(hostname)) {
      throw new SecurityError(`Direct connection to private/internal IP address '${hostname}' is prohibited.`);
    }
  }

  return parsed;
}

/**
 * Resolves the hostname via DNS and verifies that all resolved IP addresses are safe.
 */
export async function assertSafeDestination(parsedUrl: URL): Promise<void> {
  const hostname = parsedUrl.hostname;

  if (net.isIP(hostname)) {
    if (!isSafeIP(hostname)) {
      throw new SecurityError(`Connection to private IP ${hostname} is blocked.`);
    }
    return;
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new SecurityError(`Failed to resolve DNS for ${hostname}: ${errorMsg}`);
  }

  if (!addresses || addresses.length === 0) {
    throw new SecurityError(`No IP addresses found for hostname ${hostname}`);
  }

  for (const { address } of addresses) {
    if (!isSafeIP(address)) {
      throw new SecurityError(
        `Host ${hostname} resolves to blocked internal/private address (${address}). Connection aborted.`
      );
    }
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxSizeBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  headers: Headers;
  text: () => Promise<string>;
  buffer: () => Promise<Buffer>;
}

/**
 * SSRF-safe fetch implementation that validates DNS resolutions and redirect hops.
 */
export async function safeFetch(
  targetUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const {
    timeoutMs = 12000,
    maxSizeBytes = 10 * 1024 * 1024, // 10 MB limit
    maxRedirects = 5,
    headers = {},
  } = options;

  let currentUrl = targetUrl;
  let redirectsCount = 0;

  while (redirectsCount <= maxRedirects) {
    const parsed = validateUrlStructure(currentUrl);
    await assertSafeDestination(parsed);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(currentUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Docu/1.0 (Documentation Offline Converter; +https://github.com/sanstack256/Docu)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...headers,
        },
        signal: controller.signal,
        redirect: "manual", // Handle redirects manually to enforce security checks on every hop
      });

      clearTimeout(timeoutId);

      // Check for redirect status
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new SecurityError(`Redirect status ${response.status} returned without Location header.`);
        }

        const nextUrl = new URL(location, currentUrl).href;
        redirectsCount++;
        if (redirectsCount > maxRedirects) {
          throw new SecurityError(`Too many redirects (exceeded limit of ${maxRedirects}).`);
        }
        currentUrl = nextUrl;
        continue;
      }

      // Check Content-Length if present
      const contentLengthHeader = response.headers.get("content-length");
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(contentLength) && contentLength > maxSizeBytes) {
          throw new SecurityError(`Response size (${contentLength} bytes) exceeds maximum limit of ${maxSizeBytes} bytes.`);
        }
      }

      return {
        url: currentUrl,
        status: response.status,
        headers: response.headers,
        text: async () => {
          const arrayBuffer = await response.arrayBuffer();
          if (arrayBuffer.byteLength > maxSizeBytes) {
            throw new SecurityError(`Downloaded content exceeds maximum limit of ${maxSizeBytes} bytes.`);
          }
          return Buffer.from(arrayBuffer).toString("utf-8");
        },
        buffer: async () => {
          const arrayBuffer = await response.arrayBuffer();
          if (arrayBuffer.byteLength > maxSizeBytes) {
            throw new SecurityError(`Downloaded content exceeds maximum limit of ${maxSizeBytes} bytes.`);
          }
          return Buffer.from(arrayBuffer);
        },
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof SecurityError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new SecurityError(`Request to ${currentUrl} timed out after ${timeoutMs}ms.`);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch ${currentUrl}: ${message}`);
    }
  }

  throw new SecurityError(`Too many redirects while accessing ${targetUrl}.`);
}
