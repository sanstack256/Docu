import { describe, it, expect } from "vitest";
import {
  isPrivateIPv4,
  isPrivateIPv6,
  isSafeIP,
  validateUrlStructure,
  SecurityError,
} from "../security";

describe("Security & SSRF Protections", () => {
  describe("IPv4 Filtering", () => {
    it("blocks loopback addresses (127.0.0.0/8)", () => {
      expect(isPrivateIPv4("127.0.0.1")).toBe(true);
      expect(isPrivateIPv4("127.255.255.255")).toBe(true);
      expect(isSafeIP("127.0.0.1")).toBe(false);
    });

    it("blocks private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)", () => {
      expect(isPrivateIPv4("10.0.0.1")).toBe(true);
      expect(isPrivateIPv4("10.254.1.1")).toBe(true);
      expect(isPrivateIPv4("172.16.0.1")).toBe(true);
      expect(isPrivateIPv4("172.31.255.254")).toBe(true);
      expect(isPrivateIPv4("192.168.1.1")).toBe(true);
      expect(isPrivateIPv4("192.168.0.254")).toBe(true);
    });

    it("blocks cloud metadata & link-local address (169.254.169.254)", () => {
      expect(isPrivateIPv4("169.254.169.254")).toBe(true);
      expect(isPrivateIPv4("169.254.1.1")).toBe(true);
      expect(isSafeIP("169.254.169.254")).toBe(false);
    });

    it("blocks carrier-grade NAT (100.64.0.0/10)", () => {
      expect(isPrivateIPv4("100.64.0.1")).toBe(true);
      expect(isPrivateIPv4("100.127.255.254")).toBe(true);
    });

    it("allows public IPv4 addresses", () => {
      expect(isPrivateIPv4("8.8.8.8")).toBe(false);
      expect(isPrivateIPv4("1.1.1.1")).toBe(false);
      expect(isPrivateIPv4("93.184.216.34")).toBe(false);
      expect(isSafeIP("93.184.216.34")).toBe(true);
    });
  });

  describe("IPv6 Filtering", () => {
    it("blocks IPv6 loopback (::1, expanded, and bracketed) and unspecified (::)", () => {
      expect(isPrivateIPv6("::1")).toBe(true);
      expect(isPrivateIPv6("0:0:0:0:0:0:0:1")).toBe(true);
      expect(isPrivateIPv6("[::1]")).toBe(true);
      expect(isPrivateIPv6("::")).toBe(true);
      expect(isSafeIP("::1")).toBe(false);
      expect(isSafeIP("[::1]")).toBe(false);
    });

    it("blocks IPv6 unique local (fc00::/7, including AWS metadata fd00:ec2::254) and link-local (fe80::/10)", () => {
      expect(isPrivateIPv6("fc00::1")).toBe(true);
      expect(isPrivateIPv6("fd12:3456:789a::1")).toBe(true);
      expect(isPrivateIPv6("fd00:ec2::254")).toBe(true);
      expect(isPrivateIPv6("fe80::1")).toBe(true);
      expect(isPrivateIPv6("fe80::1%lo0")).toBe(true);
    });

    it("blocks IPv4-mapped IPv6 in both dotted-quad and hex-pair forms", () => {
      expect(isPrivateIPv6("::ffff:127.0.0.1")).toBe(true);
      expect(isPrivateIPv6("::ffff:7f00:1")).toBe(true);
      expect(isPrivateIPv6("::ffff:192.168.1.1")).toBe(true);
      expect(isPrivateIPv6("::ffff:c0a8:101")).toBe(true);
      expect(isPrivateIPv6("::ffff:169.254.169.254")).toBe(true);
      expect(isPrivateIPv6("::ffff:a9fe:a9fe")).toBe(true);
      // Public IPv4 mapped in IPv6 should be allowed
      expect(isPrivateIPv6("::ffff:93.184.216.34")).toBe(false);
    });

    it("blocks 6to4, Teredo, and documentation IPv6 ranges", () => {
      expect(isPrivateIPv6("2002:7f00:0001::1")).toBe(true); // 6to4 embedding 127.0.0.1
      expect(isPrivateIPv6("2001:0000:4136:e378:8000:63bf:3fff:fdd2")).toBe(true); // Teredo
      expect(isPrivateIPv6("2001:db8::1")).toBe(true); // Documentation
      // Public global unicast IPv6 (e.g., Google Public DNS 2001:4860:4860::8888)
      expect(isPrivateIPv6("2001:4860:4860::8888")).toBe(false);
    });
  });

  describe("URL Validation", () => {
    it("accepts valid public HTTP and HTTPS URLs", () => {
      const u1 = validateUrlStructure("https://docs.python.org/3/");
      expect(u1.protocol).toBe("https:");
      expect(u1.hostname).toBe("docs.python.org");

      const u2 = validateUrlStructure("http://example.com/guide");
      expect(u2.protocol).toBe("http:");
      expect(u2.hostname).toBe("example.com");
    });

    it("rejects non-HTTP schemes", () => {
      expect(() => validateUrlStructure("file:///etc/passwd")).toThrow(SecurityError);
      expect(() => validateUrlStructure("ftp://ftp.example.com")).toThrow(SecurityError);
      expect(() => validateUrlStructure("javascript:alert(1)")).toThrow(SecurityError);
      expect(() => validateUrlStructure("data:text/html,<h1>Hi</h1>")).toThrow(SecurityError);
    });

    it("rejects localhost, internal domains, and cloud metadata hostnames", () => {
      expect(() => validateUrlStructure("http://localhost:3000")).toThrow(SecurityError);
      expect(() => validateUrlStructure("http://sub.localhost/docs")).toThrow(SecurityError);
      expect(() => validateUrlStructure("http://api.local/docs")).toThrow(SecurityError);
      expect(() => validateUrlStructure("http://service.internal")).toThrow(SecurityError);
      expect(() => validateUrlStructure("http://metadata.google.internal/computeMetadata/v1/")).toThrow(SecurityError);
    });

    it("rejects direct private IPv4, integer/hex IPv4, and bracketed IPv6 URLs", () => {
      expect(() => validateUrlStructure("http://127.0.0.1/admin")).toThrow(SecurityError);
      expect(() => validateUrlStructure("http://2130706433/admin")).toThrow(SecurityError); // 127.0.0.1 in decimal
      expect(() => validateUrlStructure("http://0x7f000001/admin")).toThrow(SecurityError); // 127.0.0.1 in hex
      expect(() => validateUrlStructure("http://169.254.169.254/latest/meta-data/")).toThrow(SecurityError);
      expect(() => validateUrlStructure("http://10.0.0.5/api")).toThrow(SecurityError);
      expect(() => validateUrlStructure("http://[::1]:8080/secret")).toThrow(SecurityError);
      expect(() => validateUrlStructure("http://[::ffff:127.0.0.1]/secret")).toThrow(SecurityError);
      expect(() => validateUrlStructure("http://[fd00:ec2::254]/latest/meta-data/")).toThrow(SecurityError);
    });

    it("rejects URLs containing embedded credentials", () => {
      expect(() => validateUrlStructure("https://user:password@docs.example.com/")).toThrow(SecurityError);
      expect(() => validateUrlStructure("http://admin@example.com/")).toThrow(SecurityError);
    });

    it("rejects malformed URLs", () => {
      expect(() => validateUrlStructure("not-a-url")).toThrow(SecurityError);
      expect(() => validateUrlStructure("http://")).toThrow(SecurityError);
    });
  });
});
