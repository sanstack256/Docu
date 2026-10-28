import { NextResponse } from "next/server";
import {
  verifyStripeWebhookSignature,
  processStripeWebhookEvent,
  StripeWebhookEvent,
} from "@/lib/billing";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature") || "";

  // If webhook secret is configured, require cryptographic signature verification
  if (secret) {
    const { valid, error } = verifyStripeWebhookSignature(rawBody, sigHeader, secret);
    if (!valid) {
      return NextResponse.json({ error: error || "Invalid signature" }, { status: 400 });
    }
  }

  try {
    const event = JSON.parse(rawBody) as StripeWebhookEvent;
    const result = processStripeWebhookEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Malformed event payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

