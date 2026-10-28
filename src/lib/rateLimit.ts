import fs from "node:fs";
import path from "node:path";

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitBucket>();

/**
 * Checks and records a rate-limited action using a sliding window.
 *
 * @param key Unique client key (IP or session ID) + action namespace
 * @param maxRequests Maximum requests allowed within windowMs
 * @param windowMs Duration of the rate limit window in milliseconds
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs = 60 * 1000
): { allowed: boolean; remaining: number; resetSeconds: number } {
  const now = Date.now();
  const bucket = rateLimitStore.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (bucket.count >= maxRequests) {
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return {
      allowed: false,
      remaining: 0,
      resetSeconds,
    };
  }

  bucket.count++;
  return {
    allowed: true,
    remaining: maxRequests - bucket.count,
    resetSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/**
 * Extracts client IP from standard request headers.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "127.0.0.1";
}

/**
 * Performs periodic cleanup of old files in `.docu_storage` to enforce disk quotas and expiration.
 */
export function pruneStorageDirectory(maxAgeMs = 60 * 60 * 1000): void {
  const storageDir = path.join(process.cwd(), ".docu_storage");
  const subDirs = ["downloads", "jobs", "tokens"];
  const now = Date.now();

  for (const sub of subDirs) {
    const dirPath = path.join(storageDir, sub);
    try {
      if (!fs.existsSync(dirPath)) continue;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // Ignore
        }
      }
    } catch {
      // Ignore
    }
  }
}
