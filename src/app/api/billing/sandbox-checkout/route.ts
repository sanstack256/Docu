import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { updateSessionSubscription } from "@/lib/quota";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = url.searchParams.get("session") || "";
  const sig = url.searchParams.get("sig") || "";

  const expectedSig = crypto
    .createHmac("sha256", process.env.DOCU_SECRET || "docu-sandbox-secret")
    .update(`${session}:pro`)
    .digest("hex");

  if (sig !== expectedSig) {
    return new NextResponse("Invalid or expired sandbox signature.", { status: 403 });
  }

  // Activate Pro subscription for this session
  updateSessionSubscription(session, {
    customerId: `cus_test_${session.slice(0, 10)}`,
    subscriptionId: `sub_test_${crypto.randomBytes(8).toString("hex")}`,
    status: "active",
    currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
  });

  // Redirect back to main application with confirmation
  return NextResponse.redirect(new URL("/?upgraded=true", url.origin));
}
