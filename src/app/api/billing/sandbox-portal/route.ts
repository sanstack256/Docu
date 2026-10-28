import { NextResponse } from "next/server";
import { updateSessionSubscription } from "@/lib/quota";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = url.searchParams.get("session") || "";
  const action = url.searchParams.get("action");

  if (action === "cancel") {
    updateSessionSubscription(session, null);
    return NextResponse.redirect(new URL("/?canceled_sub=true", url.origin));
  }

  // Render a minimal sandbox portal page where user or automated test can cancel
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Docu Sandbox Customer Portal</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 40px 20px; display: flex; justify-content: center; }
          .card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 480px; width: 100%; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
          h1 { font-size: 20px; margin-top: 0; color: #0f172a; }
          p { font-size: 14px; color: #475569; line-height: 1.5; }
          .btn-cancel { display: inline-block; background: #dc2626; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 500; margin-top: 16px; }
          .btn-cancel:hover { background: #b91c1c; }
          .btn-back { display: inline-block; color: #64748b; font-size: 13px; text-decoration: none; margin-left: 12px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Docu Pro Subscription (Sandbox)</h1>
          <p>You have an active Docu Pro subscription (20 exports/month, up to 500 pages per export).</p>
          <p>This is a sandbox test portal for verifying subscription lifecycle and cancellation.</p>
          <div>
            <a href="/api/billing/sandbox-portal?session=${session}&action=cancel" class="btn-cancel">Cancel Pro Subscription</a>
            <a href="/" class="btn-back">Back to Docu</a>
          </div>
        </div>
      </body>
    </html>
  `;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
