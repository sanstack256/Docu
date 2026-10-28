import crypto from "node:crypto";

const SESSION_COOKIE_NAME = "docu_session";
const SECRET_KEY = process.env.DOCU_SECRET || "docu-production-secret-seed-98314";

function sign(val: string): string {
  const hmac = crypto.createHmac("sha256", SECRET_KEY).update(val).digest("hex");
  return `${val}.${hmac}`;
}

function verify(signedVal: string): string | null {
  const parts = signedVal.split(".");
  if (parts.length !== 2) return null;
  const [val, expectedHmac] = parts;
  const calculatedHmac = crypto.createHmac("sha256", SECRET_KEY).update(val).digest("hex");

  const bufA = Buffer.from(expectedHmac, "hex");
  const bufB = Buffer.from(calculatedHmac, "hex");
  if (bufA.length !== bufB.length) return null;

  if (crypto.timingSafeEqual(bufA, bufB)) {
    return val;
  }
  return null;
}

/**
 * Extracts or initializes a secure session ID from the request cookies.
 */
export function getOrCreateSessionId(req: Request): { sessionId: string; isNew: boolean } {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));

  if (match) {
    const rawVal = decodeURIComponent(match[1]);
    const verified = verify(rawVal);
    if (verified && /^[a-f0-9]{32}$/i.test(verified)) {
      return { sessionId: verified, isNew: false };
    }
  }

  // Generate new 32-hex session ID
  const newSessionId = crypto.randomBytes(16).toString("hex");
  return { sessionId: newSessionId, isNew: true };
}

/**
 * Builds the Set-Cookie header value for the docu_session cookie.
 */
export function buildSessionCookieHeader(sessionId: string): string {
  const signed = sign(sessionId);
  // 365 days expiration
  const maxAge = 365 * 24 * 60 * 60;
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
}
