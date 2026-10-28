import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  updateSessionSubscription,
  linkCustomerToSession,
  getSessionByCustomerId,
  SubscriptionRecord,
} from "./quota";

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

const STORAGE_DIR = path.join(process.cwd(), ".docu_storage");
const PROCESSED_EVENTS_DIR = path.join(STORAGE_DIR, "webhook_events");

function ensureEventsDir(): void {
  try {
    if (!fs.existsSync(PROCESSED_EVENTS_DIR)) {
      fs.mkdirSync(PROCESSED_EVENTS_DIR, { recursive: true });
    }
  } catch {
    // Ignore
  }
}

/**
 * Verifies the cryptographic Stripe webhook signature using HMAC-SHA256.
 * Adheres strictly to Stripe's signature format: `t=timestamp,v1=signature`.
 * Tolerates up to 300 seconds of clock drift.
 */
export function verifyStripeWebhookSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
  toleranceSeconds = 300
): { valid: boolean; error?: string } {
  if (!sigHeader || !secret) {
    return { valid: false, error: "Missing signature header or webhook secret." };
  }

  const parts = sigHeader.split(",").reduce<Record<string, string>>((acc, item) => {
    const [k, v] = item.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) {
    return { valid: false, error: "Malformed stripe-signature header." };
  }

  const tsNum = parseInt(timestamp, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (isNaN(tsNum) || Math.abs(nowSec - tsNum) > toleranceSeconds) {
    return { valid: false, error: "Webhook timestamp outside tolerance window." };
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf-8")
    .digest("hex");

  // Constant-time comparison
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return { valid: false, error: "Signature length mismatch." };
  }

  const matches = crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  return { valid: matches, error: matches ? undefined : "Signature verification failed." };
}

/**
 * Checks if a webhook event has already been processed to ensure idempotency.
 */
export function isEventAlreadyProcessed(eventId: string): boolean {
  try {
    ensureEventsDir();
    const filePath = path.join(PROCESSED_EVENTS_DIR, `${eventId}.json`);
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Records that an event has been processed.
 */
export function markEventAsProcessed(eventId: string, eventType: string): void {
  try {
    ensureEventsDir();
    const filePath = path.join(PROCESSED_EVENTS_DIR, `${eventId}.json`);
    fs.writeFileSync(
      filePath,
      JSON.stringify({ eventId, eventType, processedAt: Date.now() }),
      "utf-8"
    );
  } catch {
    // Ignore
  }
}

/**
 * Handles incoming Stripe webhook events and updates subscription entitlements.
 */
export function processStripeWebhookEvent(event: StripeWebhookEvent): {
  success: boolean;
  handled: boolean;
  message: string;
} {
  const eventId = event.id;
  if (!eventId) {
    return { success: false, handled: false, message: "Missing event ID." };
  }

  if (isEventAlreadyProcessed(eventId)) {
    return { success: true, handled: true, message: "Event already processed (idempotent)." };
  }

  const eventType = event.type;
  const obj = event.data?.object;

  switch (eventType) {
    case "checkout.session.completed": {
      const customerId = (obj.customer as string) || `cus_${crypto.randomBytes(8).toString("hex")}`;
      const subscriptionId = (obj.subscription as string) || `sub_${crypto.randomBytes(8).toString("hex")}`;
      const clientRefId = (obj.client_reference_id as string) || "";

      if (clientRefId) {
        linkCustomerToSession(customerId, clientRefId);
        const subRecord: SubscriptionRecord = {
          customerId,
          subscriptionId,
          status: "active",
          currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
          createdAt: Date.now(),
        };
        updateSessionSubscription(clientRefId, subRecord);
      }
      break;
    }

    case "customer.subscription.updated": {
      const customerId = obj.customer as string;
      const status = (obj.status as string) === "active" ? "active" : "canceled";
      const periodEnd = ((obj.current_period_end as number) || 0) * 1000 || Date.now() + 30 * 24 * 60 * 60 * 1000;
      const sessionId = getSessionByCustomerId(customerId);

      if (sessionId) {
        const subRecord: SubscriptionRecord = {
          customerId,
          subscriptionId: obj.id as string,
          status,
          currentPeriodEnd: periodEnd,
          createdAt: Date.now(),
        };
        updateSessionSubscription(sessionId, subRecord);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const customerId = obj.customer as string;
      const sessionId = getSessionByCustomerId(customerId);
      if (sessionId) {
        updateSessionSubscription(sessionId, null);
      }
      break;
    }

    case "invoice.payment_failed": {
      const customerId = obj.customer as string;
      const sessionId = getSessionByCustomerId(customerId);
      if (sessionId) {
        updateSessionSubscription(sessionId, {
          customerId,
          subscriptionId: (obj.subscription as string) || "",
          status: "past_due",
          currentPeriodEnd: Date.now(),
          createdAt: Date.now(),
        });
      }
      break;
    }

    default:
      // Other unhandled events are acknowledged cleanly
      break;
  }

  markEventAsProcessed(eventId, eventType);
  return { success: true, handled: true, message: `Processed ${eventType}` };
}

/**
 * Creates a checkout session for Docu Pro ($12/month).
 * If Stripe secret key is present, calls the Stripe REST API.
 * In local sandbox / testing mode, returns a sandbox checkout link.
 */
export async function createCheckoutSession(
  sessionId: string,
  origin: string
): Promise<{ url: string; sandbox: boolean }> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const successUrl = `${origin}?session_id=${sessionId}&upgraded=true`;
  const cancelUrl = `${origin}?billing_canceled=true`;

  if (stripeSecret && stripeSecret.startsWith("sk_")) {
    // Official Stripe REST API call
    const params = new URLSearchParams({
      "payment_method_types[0]": "card",
      "mode": "subscription",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][product_data][name]": "Docu Pro Subscription",
      "line_items[0][price_data][product_data][description]": "20 manual exports/month, up to 500 pages per manual, custom titles",
      "line_items[0][price_data][unit_amount]": "1200", // $12.00
      "line_items[0][price_data][recurring][interval]": "month",
      "line_items[0][quantity]": "1",
      "client_reference_id": sessionId,
      "success_url": successUrl,
      "cancel_url": cancelUrl,
    });

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Stripe checkout creation failed: ${errText}`);
    }

    const data = await res.json();
    return { url: data.url, sandbox: false };
  }

  // Sandbox Mode: Provides a verifiable sandbox activation URL for testing without live charges
  const sandboxToken = crypto
    .createHmac("sha256", process.env.DOCU_SECRET || "docu-sandbox-secret")
    .update(`${sessionId}:pro`)
    .digest("hex");

  const sandboxUrl = `${origin}/api/billing/sandbox-checkout?session=${sessionId}&sig=${sandboxToken}`;
  return { url: sandboxUrl, sandbox: true };
}

/**
 * Creates a Customer Portal session for subscription cancellation or updating payment method.
 */
export async function createCustomerPortalSession(
  sessionId: string,
  origin: string
): Promise<{ url: string; sandbox: boolean }> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;

  if (stripeSecret && stripeSecret.startsWith("sk_")) {
    // Find customer ID mapped to this session
    // For standard Stripe flow:
    const returnUrl = `${origin}?portal_return=true`;
    const params = new URLSearchParams({
      return_url: returnUrl,
    });

    const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (res.ok) {
      const data = await res.json();
      return { url: data.url, sandbox: false };
    }
  }

  // Fallback / Sandbox Portal
  return { url: `${origin}/api/billing/sandbox-portal?session=${sessionId}`, sandbox: true };
}

