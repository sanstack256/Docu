import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Docu",
  description: "Privacy policy and data retention terms for Docu documentation converter.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between text-slate-900 font-sans">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-2 text-left">
            <span className="bg-blue-600 text-white font-bold text-sm px-2 py-0.5 rounded">DOCU</span>
            <span className="font-semibold text-slate-800 text-base">Offline Manual Converter</span>
          </Link>
          <Link href="/" className="text-xs text-blue-600 hover:underline font-medium">
            ← Back to Converter
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 w-full flex-grow">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6 sm:p-10">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
          <p className="text-xs text-slate-500 mb-8">Last updated: October 29, 2026</p>

          <div className="space-y-6 text-sm text-slate-700 leading-relaxed">
            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">1. Overview</h2>
              <p>
                Docu is designed with minimal data collection principles. We do not sell your personal data, track your browsing across the internet, or feed your documents into artificial intelligence models.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">2. Information We Process</h2>
              <p>
                When you use Docu, we process the following information strictly to provide the conversion service:
              </p>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li><strong>Submitted URLs:</strong> The website and documentation URLs you provide for discovery and conversion.</li>
                <li><strong>Extracted Content:</strong> HTML, text, and images retrieved from the public URLs you submit, used exclusively to compile your requested PDF.</li>
                <li><strong>Session Identifier:</strong> A cryptographically signed session cookie (<code>docu_session</code>) used solely to track monthly quota entitlements (Free vs. Pro).</li>
                <li><strong>Payment Information:</strong> For Pro subscribers, payment transactions are processed directly by Stripe. Docu never stores your credit card numbers or financial credentials.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">3. Data Retention and Deletion</h2>
              <p>
                We enforce a strict retention schedule:
              </p>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li><strong>Generated PDFs:</strong> All generated PDF manual files are stored in a secure temporary directory and automatically deleted after <strong>1 hour</strong>.</li>
                <li><strong>Download Tokens:</strong> Download tokens expire and are purged after 1 hour.</li>
                <li><strong>Job Metadata:</strong> Job progress logs are purged upon file expiration.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">4. Cookies and Tracking</h2>
              <p>
                Docu uses only strictly necessary first-party cookies:
              </p>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li><code>docu_session</code>: An HTTP-only, secure HMAC-signed cookie used to preserve your monthly export quota and Pro status.</li>
              </ul>
              <p className="mt-2">
                We do not use advertising cookies, cross-site trackers, or third-party analytics scripts.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">5. Third-Party Service Providers</h2>
              <p>
                We use Stripe for payment processing. Your interaction with Stripe is governed by the Stripe Privacy Policy.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">6. Security Measures</h2>
              <p>
                Docu employs strict server-side request forgery (SSRF) protections, IP blocking for private/cloud networks, bounded memory execution, rate limiting, and encrypted HTTPS connections to prevent unauthorized access.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">7. Contact</h2>
              <p>
                For questions regarding this policy or data inquiries, contact the repository maintainers via GitHub.
              </p>
            </section>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500 bg-white">
        <p>Docu — Universal Deterministic Offline Manual Converter • Respects site policies & copyright</p>
      </footer>
    </div>
  );
}
