import { describe, it, expect, beforeEach } from "vitest";
import {
  getOrCreateQuotaRecord,
  getQuotaStatus,
  consumeExportQuota,
  updateSessionSubscription,
} from "../quota";

describe("Server-Side Quota & Entitlement Enforcement", () => {
  const testSessionId = "test-session-quota-1234567890abcdef";

  beforeEach(() => {
    // Reset session to fresh state
    const record = getOrCreateQuotaRecord(testSessionId);
    record.plan = "free";
    record.exportsUsed = 0;
    delete record.subscription;
  });

  it("initializes new sessions with Free plan defaults", () => {
    const status = getQuotaStatus(testSessionId);
    expect(status.plan).toBe("free");
    expect(status.exportsUsed).toBe(0);
    expect(status.exportsRemaining).toBe(2);
    expect(status.maxPagesPerExport).toBe(20);
    expect(status.allowsCustomTitle).toBe(false);
  });

  it("rejects custom cover titles on Free plan", () => {
    const result = consumeExportQuota(testSessionId, 5, true);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Custom document titles require a Pro subscription");
    expect(result.remaining).toBe(2);
  });

  it("rejects export exceeding 20 pages on Free plan", () => {
    const result = consumeExportQuota(testSessionId, 25, false);
    expect(result.success).toBe(false);
    expect(result.error).toContain("exceeds the FREE plan limit of 20 pages");
    expect(result.remaining).toBe(2);
  });

  it("allows up to 2 valid exports and exhausts quota on 3rd attempt", () => {
    // Export 1
    const res1 = consumeExportQuota(testSessionId, 10, false);
    expect(res1.success).toBe(true);
    expect(res1.remaining).toBe(1);

    // Export 2
    const res2 = consumeExportQuota(testSessionId, 15, false);
    expect(res2.success).toBe(true);
    expect(res2.remaining).toBe(0);

    // Export 3 (Should fail)
    const res3 = consumeExportQuota(testSessionId, 5, false);
    expect(res3.success).toBe(false);
    expect(res3.error).toContain("limit of 2 exports for this 30-day period");
    expect(res3.remaining).toBe(0);
  });

  it("upgrades session to Pro plan and unlocks 20 exports, 500 pages, and custom titles", () => {
    updateSessionSubscription(testSessionId, {
      customerId: "cus_mock_123",
      subscriptionId: "sub_mock_123",
      status: "active",
      currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });

    const status = getQuotaStatus(testSessionId);
    expect(status.plan).toBe("pro");
    expect(status.maxExports).toBe(20);
    expect(status.maxPagesPerExport).toBe(500);
    expect(status.allowsCustomTitle).toBe(true);

    // Test Pro export with 150 pages and custom title
    const exportRes = consumeExportQuota(testSessionId, 150, true);
    expect(exportRes.success).toBe(true);
    expect(exportRes.remaining).toBe(19);
  });

  it("downgrades session to Free plan when subscription is canceled", () => {
    // Upgrade to Pro first
    updateSessionSubscription(testSessionId, {
      customerId: "cus_mock_123",
      subscriptionId: "sub_mock_123",
      status: "active",
      currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
    expect(getQuotaStatus(testSessionId).plan).toBe("pro");

    // Cancel subscription
    updateSessionSubscription(testSessionId, null);
    const downgradedStatus = getQuotaStatus(testSessionId);
    expect(downgradedStatus.plan).toBe("free");
    expect(downgradedStatus.maxPagesPerExport).toBe(20);
    expect(downgradedStatus.allowsCustomTitle).toBe(false);
  });
});
