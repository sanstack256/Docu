import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  verifyStripeWebhookSignature,
  processStripeWebhookEvent,
  isEventAlreadyProcessed,
} from "../billing";
import { getQuotaStatus } from "../quota";

describe("Cryptographic Stripe Webhook & Billing Verification", () => {
  const webhookSecret = "whsec_test_secret_key_abcdef1234567890";

  it("verifies authentic Stripe HMAC-SHA256 signatures", () => {
    const payload = JSON.stringify({ id: "evt_test_1", type: "ping" });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    const header = `t=${timestamp},v1=${signature}`;
    const result = verifyStripeWebhookSignature(payload, header, webhookSecret);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects tampered webhook payloads", () => {
    const payload = JSON.stringify({ id: "evt_test_1", amount: 100 });
    const tamperedPayload = JSON.stringify({ id: "evt_test_1", amount: 0 });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    const header = `t=${timestamp},v1=${signature}`;
    const result = verifyStripeWebhookSignature(tamperedPayload, header, webhookSecret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("failed");
  });

  it("rejects timestamps exceeding tolerance window", () => {
    const payload = JSON.stringify({ id: "evt_test_1" });
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 minutes ago
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(`${oldTimestamp}.${payload}`)
      .digest("hex");

    const header = `t=${oldTimestamp},v1=${signature}`;
    const result = verifyStripeWebhookSignature(payload, header, webhookSecret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("tolerance");
  });

  it("processes checkout.session.completed and upgrades user entitlement idempotently", () => {
    const testSession = "test_billing_sess_abc123";
    const eventId = `evt_checkout_${Date.now()}_${Math.random()}`;

    const event = {
      id: eventId,
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_stripe_real_123",
          subscription: "sub_stripe_real_456",
          client_reference_id: testSession,
        },
      },
    };

    const firstRun = processStripeWebhookEvent(event);
    expect(firstRun.success).toBe(true);
    expect(isEventAlreadyProcessed(eventId)).toBe(true);

    const statusAfterUpgrade = getQuotaStatus(testSession);
    expect(statusAfterUpgrade.plan).toBe("pro");
    expect(statusAfterUpgrade.maxExports).toBe(20);

    // Idempotent second run
    const secondRun = processStripeWebhookEvent(event);
    expect(secondRun.success).toBe(true);
    expect(secondRun.message).toContain("idempotent");
  });

  it("handles customer.subscription.deleted and revokes Pro plan", () => {
    const testSession = "test_billing_sess_downgrade";
    const customerId = `cus_test_${Date.now()}`;

    // Initial setup: user upgraded
    const checkoutEvent = {
      id: `evt_init_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          customer: customerId,
          subscription: "sub_test_down_123",
          client_reference_id: testSession,
        },
      },
    };
    processStripeWebhookEvent(checkoutEvent);
    expect(getQuotaStatus(testSession).plan).toBe("pro");

    // Subscription deleted webhook arrives
    const deleteEvent = {
      id: `evt_del_${Date.now()}`,
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_test_down_123",
          customer: customerId,
        },
      },
    };
    const delResult = processStripeWebhookEvent(deleteEvent);
    expect(delResult.success).toBe(true);

    // Verify revoked to Free
    expect(getQuotaStatus(testSession).plan).toBe("free");
  });
});

