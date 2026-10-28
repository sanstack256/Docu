import { NextResponse } from "next/server";
import { getOrCreateSessionId, buildSessionCookieHeader } from "@/lib/session";
import { getQuotaStatus } from "@/lib/quota";

export async function GET(request: Request) {
  const { sessionId, isNew } = getOrCreateSessionId(request);
  const status = getQuotaStatus(sessionId);

  const response = NextResponse.json({
    status: "ok",
    ...status,
  });

  if (isNew) {
    response.headers.set("Set-Cookie", buildSessionCookieHeader(sessionId));
  }

  return response;
}

