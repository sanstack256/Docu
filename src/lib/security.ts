import dns from "node:dns";
import net from "node:net";

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "0.0.0.0",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "wpad",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".lan",
  ".home.arpa",
  ".intranet",
  ".corp",
];

/**
 * Strips IPv6 square brackets from a URL hostname if present.
 */
export function stripBrackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * Checks whether an IPv4 address is in a reserved/private/internal range.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // Malformed is unsafe
  }

  const [a, b, c] = parts;

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
  if (a === 192 && b === 0 && c === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) return true;

  // 192.88.99.0/24 (6to4 Relay Anycast)
  if (a === 192 && b === 88 && c === 99) return true;

  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15 (Benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;

  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4 (Reserved / Future use / Broadcast)
  if (a >= 240) return true;

  return false;
}

/**
 * Expands an IPv6 address into 8 16-bit integers (0..65535).
 * Returns null if the address is invalid.
 */
export function parseIPv6Words(rawIp: string): number[] | null {
  // Strip zone index if present (e.g., fe80::1%lo0)
  const ip = stripBrackets(rawIp.trim().toLowerCase()).split("%")[0];
  if (!net.isIPv6(ip)) return null;

  let workingIp = ip;

  // Check if there is an embedded IPv4 address at the end (e.g. ::ffff:192.168.1.1)
  const lastColon = workingIp.lastIndexOf(":");
  if (lastColon !== -1) {
    const possibleV4 = workingIp.slice(lastColon + 1);
    if (possibleV4.includes(".")) {
      const v4Parts = possibleV4.split(".").map(Number);
      if (v4Parts.length !== 4 || v4Parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
        return null;
      }
      const highWord = ((v4Parts[0] << 8) | v4Parts[1]).toString(16);
      const lowWord = ((v4Parts[2] << 8) | v4Parts[3]).toString(16);
      workingIp = `${workingIp.slice(0, lastColon)}:${highWord}:${lowWord}`;
    }
  }

  const doubleColonParts = workingIp.split("::");
  if (doubleColonParts.length > 2) return null;

  if (doubleColonParts.length === 2) {
    const left = doubleColonParts[0] ? doubleColonParts[0].split(":") : [];
    const right = doubleColonParts[1] ? doubleColonParts[1].split(":") : [];
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    const words = [...left, ...Array(missing).fill("0"), ...right].map((w) => parseInt(w, 16));
    if (words.length !== 8 || words.some((w) => isNaN(w) || w < 0 || w > 0xffff)) return null;
    return words;
  }

  const parts = workingIp.split(":");
  if (parts.length !== 8) return null;
  const words = parts.map((w) => parseInt(w, 16));
  if (words.some((w) => isNaN(w) || w < 0 || w > 0xffff)) return null;
  return words;
}

function wordsToIPv4(highWord: number, lowWord: number): string {
  const a = (highWord >> 8) & 0xff;
  const b = highWord & 0xff;
  const c = (lowWord >> 8) & 0xff;
  const d = lowWord & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

/**
 * Checks whether an IPv6 address is in a reserved/private/internal range.
 */
export function isPrivateIPv6(ip: string): boolean {
  // Any address with a zone ID (e.g. %eth0) is link-local/internal
  if (ip.includes("%")) return true;

  const words = parseIPv6Words(ip);
  if (!words) return true; // Malformed is unsafe

  const [w0, w1, w2, w3, w4, w5, w6, w7] = words;

  // Unspecified (::/128) or Loopback (::1/128)
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0 && w6 === 0) {
    if (w7 === 0 || w7 === 1) return true;
  }

  // IPv4-mapped IPv6 (::ffff:0:0/96)
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0xffff) {
    return isPrivateIPv4(wordsToIPv4(w6, w7));
  }

  // IPv4-compatible IPv6 (::/96, deprecated)
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) {
    return isPrivateIPv4(wordsToIPv4(w6, w7));
  }

  // IPv4-translated address (::ffff:0:0:0/96)
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0xffff && w5 === 0) {
    return isPrivateIPv4(wordsToIPv4(w6, w7));
  }

  // NAT64 Well-Known Prefix (64:ff9b::/96 and 64:ff9b:1::/48)
  if (w0 === 0x0064 && w1 === 0xff9b) {
    return isPrivateIPv4(wordsToIPv4(w6, w7));
  }

  // 6to4 (2002::/16) — embeds IPv4 in w1, w2
  if (w0 === 0x2002) {
    return isPrivateIPv4(wordsToIPv4(w1, w2));
  }

  // Teredo tunneling (2001:0000::/32)
  if (w0 === 0x2001 && w1 === 0x0000) {
    return true;
  }

  // Documentation prefix (2001:db8::/32)
  if (w0 === 0x2001 && w1 === 0x0db8) {
    return true;
  }

  // Unique local addresses (fc00::/7 -> fc00 to fdff, includes AWS fd00:ec2::254)
  if ((w0 & 0xfe00) === 0xfc00) return true;

  // Link-local unicast (fe80::/10 -> fe80 to febf)
  if ((w0 & 0xffc0) === 0xfe80) return true;

  // Site-local deprecated (fec0::/10 -> fec0 to feff)
  if ((w0 & 0xffc0) === 0xfec0) return true;

  // Multicast (ff00::/8)
  if ((w0 & 0xff00) === 0xff00) return true;

  return false;
}

/**
 * Validates that an IP address is public and safe to connect to.
 */
export function isSafeIP(rawIp: string): boolean {
  const ip = stripBrackets(rawIp.trim());
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
 * Validates a target URL structure, protocol, credentials, and hostname.
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

  // Reject URLs containing embedded credentials
  if (parsed.username || parsed.password) {
    throw new SecurityError("URLs containing embedded credentials are not permitted.");
  }

  // Reject empty or local hostnames
  const rawHostname = parsed.hostname.toLowerCase();
  const hostname = stripBrackets(rawHostname);
  if (!hostname) {
    throw new SecurityError("URL is missing a valid hostname.");
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new SecurityError(`Access to internal hostname '${hostname}' is prohibited.`);
  }

  // Check if hostname is an IP directly (IPv4 or IPv6)
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
  const hostname = stripBrackets(parsedUrl.hostname.toLowerCase());

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
  retries?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  headers: Headers;
  text: () => Promise<string>;
  buffer: () => Promise<Buffer>;
}

const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Reads a Response body stream with an enforced byte limit so oversized responses
 * without Content-Length headers cannot exhaust worker memory.
 */
async function readBoundedBody(response: Response, maxSizeBytes: number): Promise<Buffer> {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxSizeBytes) {
      throw new SecurityError(`Downloaded content exceeds maximum limit of ${maxSizeBytes} bytes.`);
    }
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxSizeBytes) {
          await reader.cancel();
          throw new SecurityError(`Downloaded content exceeds maximum limit of ${maxSizeBytes} bytes.`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

/**
 * SSRF-safe fetch implementation that validates DNS resolutions, redirect hops,
 * response size limits, and performs bounded retries on transient failures.
 */
export async function safeFetch(
  targetUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const {
    timeoutMs = 12000,
    maxSizeBytes = 10 * 1024 * 1024, // 10 MB limit
    maxRedirects = 5,
    retries = 1,
    headers = {},
  } = options;

  let attempt = 0;

  while (attempt <= retries) {
    let currentUrl = targetUrl;
    let redirectsCount = 0;
    const visitedRedirects = new Set<string>();

    try {
      while (redirectsCount <= maxRedirects) {
        const parsed = validateUrlStructure(currentUrl);
        await assertSafeDestination(parsed);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(currentUrl, {
            method: "GET",
            headers: {
              "User-Agent": "Docu/2.0 (Documentation Offline Converter; +https://github.com/sanstack256/Docu)",
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
            if (visitedRedirects.has(nextUrl)) {
              throw new SecurityError(`Redirect loop detected while accessing ${nextUrl}.`);
            }
            visitedRedirects.add(nextUrl);

            redirectsCount++;
            if (redirectsCount > maxRedirects) {
              throw new SecurityError(`Too many redirects (exceeded limit of ${maxRedirects}).`);
            }
            currentUrl = nextUrl;
            continue;
          }

          // Retry on transient server errors if retries remain
          if (TRANSIENT_HTTP_STATUSES.has(response.status) && attempt < retries) {
            throw new Error(`Transient HTTP status ${response.status}`);
          }

          // Check Content-Length if present
          const contentLengthHeader = response.headers.get("content-length");
          if (contentLengthHeader) {
            const contentLength = parseInt(contentLengthHeader, 10);
            if (!isNaN(contentLength) && contentLength > maxSizeBytes) {
              throw new SecurityError(
                `Response size (${contentLength} bytes) exceeds maximum limit of ${maxSizeBytes} bytes.`
              );
            }
          }

          let cachedBuffer: Buffer | null = null;
          const getBuffer = async (): Promise<Buffer> => {
            if (!cachedBuffer) {
              cachedBuffer = await readBoundedBody(response, maxSizeBytes);
            }
            return cachedBuffer;
          };

          return {
            url: currentUrl,
            status: response.status,
            headers: response.headers,
            text: async () => {
              const buf = await getBuffer();
              return buf.toString("utf-8");
            },
            buffer: getBuffer,
          };
        } catch (err: unknown) {
          clearTimeout(timeoutId);
          if (err instanceof SecurityError) {
            throw err;
          }
          if (err instanceof Error && err.name === "AbortError") {
            throw new Error(`Request to ${currentUrl} timed out after ${timeoutMs}ms.`);
          }
          throw err;
        }
      }

      throw new SecurityError(`Too many redirects while accessing ${targetUrl}.`);
    } catch (err: unknown) {
      // Never retry SecurityError
      if (err instanceof SecurityError) {
        throw err;
      }

      if (attempt < retries) {
        attempt++;
        const backoffMs = 250 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("timed out")) {
        throw new SecurityError(message);
      }
      throw new Error(`Failed to fetch ${targetUrl}: ${message}`);
    }
  }

  throw new Error(`Failed to fetch ${targetUrl} after ${retries + 1} attempts.`);
}
