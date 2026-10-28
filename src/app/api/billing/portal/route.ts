import { NextResponse } from "next/server";
import { getOrCreateSessionId } from "@/lib/session";
import { createCustomerPortalSession } from "@/lib/billing";

export async function POST(request: Request) {
  try {
    const { sessionId } = getOrCreateSessionId(request);
    const origin = new URL(request.url).origin;

    const portal = await createCustomerPortalSession(sessionId, origin);
    return NextResponse.json({ url: portal.url, sandbox: portal.sandbox });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to open customer portal";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

