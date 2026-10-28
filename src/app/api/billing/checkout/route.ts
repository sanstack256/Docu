import { NextResponse } from "next/server";
import { getOrCreateSessionId, buildSessionCookieHeader } from "@/lib/session";
import { createCheckoutSession } from "@/lib/billing";

export async function POST(request: Request) {
  try {
    const { sessionId, isNew } = getOrCreateSessionId(request);
    const origin = new URL(request.url).origin;

    const session = await createCheckoutSession(sessionId, origin);

    const response = NextResponse.json({
      url: session.url,
      sandbox: session.sandbox,
    });

    if (isNew) {
      response.headers.set("Set-Cookie", buildSessionCookieHeader(sessionId));
    }

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to initialize checkout session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

