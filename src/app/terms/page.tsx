import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Terms of Service — Docu",
  description: "Terms of service and acceptable use policy for Docu documentation converter.",
};

export default function TermsOfServicePage() {
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
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Terms of Service</h1>
          <p className="text-xs text-slate-500 mb-8">Last updated: October 29, 2026</p>

          <div className="space-y-6 text-sm text-slate-700 leading-relaxed">
            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">1. Agreement to Terms</h2>
              <p>
                By accessing or using Docu, you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the application.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">2. Acceptable Use Policy</h2>
              <p>
                Docu is intended solely for converting publicly accessible technical documentation, manuals, and editorial articles for legitimate offline reading and archival purposes. You agree not to:
              </p>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>Submit private, intranet, localhost, or link-local network addresses (SSRF attempts are actively blocked and logged).</li>
                <li>Attempt to bypass paywalls, authentication mechanisms, or access controls.</li>
                <li>Infringe the intellectual property or copyrights of website owners.</li>
                <li>Use the service to scrape, harvest, or extract private personal data.</li>
                <li>Abuse rate limits or launch denial-of-service attacks against Docu or source websites.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">3. Plans, Quotas & Subscriptions</h2>
              <p>
                Docu operates under two plan tiers:
              </p>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li><strong>Free Plan:</strong> Includes 2 manual exports per 30-day period, up to 20 pages per export, with standard queue priority and default cover titles.</li>
                <li><strong>Pro Plan ($12/month):</strong> Includes 20 manual exports per 30-day period, up to 500 pages per export, custom manual cover titles, and priority processing.</li>
              </ul>
              <p className="mt-2">
                All quotas are enforced on the server. You can cancel your subscription at any time via the Customer Portal. Cancellations take effect at the conclusion of your current 30-day billing period.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">4. Output Fidelity and Limitations</h2>
              <p>
                Docu uses deterministic semantic HTML parsing to render clean PDFs. Because websites vary widely in styling, complex layouts, interactive widgets, or dynamic JavaScript-dependent behaviors may not be represented with 100% visual parity. Docu does not guarantee universal compatibility with all arbitrary web designs.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">5. Disclaimer of Warranties</h2>
              <p>
                Docu is provided on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis without warranties of any kind, whether express or implied, including fitness for a particular purpose or non-infringement.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900 mb-2">6. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by applicable law, Docu and its maintainers shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of or inability to use the service.
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
