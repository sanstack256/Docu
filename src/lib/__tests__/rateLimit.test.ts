import { describe, it, expect } from "vitest";
import { checkRateLimit } from "../rateLimit";

describe("Sliding Window Rate Limiter", () => {
  it("allows requests under the quota limit", () => {
    const key = `test_ip_${Date.now()}`;
    const r1 = checkRateLimit(key, 3, 5000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit(key, 3, 5000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit(key, 3, 5000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    // 4th request must be rejected
    const r4 = checkRateLimit(key, 3, 5000);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.resetSeconds).toBeGreaterThan(0);
  });
});
